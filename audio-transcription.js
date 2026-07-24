const { processAudioMessage, transcribeAudioWithGemini } = require("./gemini-config");

/**
 * Normalize MIME type string (remove parameters like ; codecs=..., lower-case)
 * @param {string} mime
 * @returns {string}
 */
function normalizeMimeType(mime) {
    if (!mime || typeof mime !== "string") return "";
    return mime.split(";")[0].trim().toLowerCase();
}

/**
 * Ensure audioBuffer is a Node Buffer. Accepts Buffer, ArrayBuffer, Uint8Array, etc.
 * @param {*} audioBuffer
 * @returns {Buffer|null}
 */
function toBuffer(audioBuffer) {
    if (!audioBuffer) return null;
    if (Buffer.isBuffer(audioBuffer)) return audioBuffer;
    // Typed arrays
    if (ArrayBuffer.isView(audioBuffer)) {
        return Buffer.from(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
    }
    // ArrayBuffer
    if (audioBuffer instanceof ArrayBuffer) {
        return Buffer.from(audioBuffer);
    }
    return null;
}

/**
 * Main audio processing function using Gemini
 * @param {Buffer|ArrayBuffer|TypedArray} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @param {string} voiceType - Voice type for response (male/female)
 * @returns {Promise<Object>} - Processing result with text and audio response
 */
async function processAudio(audioBuffer, mimeType, voiceType = "female") {
    try {
        // normalize and convert buffer
        const buf = toBuffer(audioBuffer);
        const normalizedMime = normalizeMimeType(mimeType);

        // Validate audio buffer
        if (!buf || buf.length === 0) {
            return {
                success: false,
                textResponse: "❌ Invalid audio file received.",
                audioResponse: null,
            };
        }

        // Validate mime type
        if (!normalizedMime) {
            return {
                success: false,
                textResponse:
                    "❌ MIME type is missing or invalid. Please provide a valid audio MIME type (e.g. 'audio/wav', 'audio/mp3').",
                audioResponse: null,
            };
        }

        // Check file size (limit to 20MB for Gemini)
        const maxSize = 20 * 1024 * 1024;
        if (buf.length > maxSize) {
            return {
                success: false,
                textResponse: "❌ Audio file too large. Please send a shorter audio message.",
                audioResponse: null,
            };
        }

        console.log(
            `Processing audio: ${normalizedMime}, size: ${(buf.length / 1024).toFixed(2)}KB`
        );

        // Optionally check supported formats before calling external service
        if (!isFormatSupported(normalizedMime)) {
            return {
                success: false,
                textResponse: `❌ Unsupported audio format: ${normalizedMime}. Supported: ${getSupportedFormats().join(
                    ", "
                )}`,
                audioResponse: null,
            };
        }

        // Process with Gemini (transcribe + respond + TTS)
        // Be defensive about the returned shape from processAudioMessage
        const result = await processAudioMessage(buf, normalizedMime, voiceType);

        // Normalize result to consistent object
        if (!result) {
            return {
                success: false,
                textResponse: "❌ Empty response from transcription service.",
                audioResponse: null,
            };
        }

        // If processAudioMessage returned a string, treat it as textResponse
        if (typeof result === "string") {
            return {
                success: true,
                textResponse: result,
                audioResponse: null,
            };
        }

        // If it returned an object, try to pick expected properties
        const textResponse =
            typeof result.textResponse === "string"
                ? result.textResponse
                : typeof result.transcript === "string"
                ? result.transcript
                : result.text || null;

        const audioResponse = result.audioResponse ?? result.tts ?? null;

        return {
            success: true,
            textResponse: textResponse ?? "✅ Audio processed but no text was returned.",
            audioResponse,
            raw: result, // include raw for debugging if needed
        };
    } catch (error) {
        console.error("Audio processing error:", error);
        return {
            success: false,
            textResponse: "❌ Failed to process audio message. Please try again.",
            audioResponse: null,
            error: error && error.message ? error.message : String(error),
        };
    }
}

/**
 * Transcribe audio only (without TTS response)
 * @param {Buffer|ArrayBuffer|TypedArray} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @returns {Promise<string>} - Transcribed text or error message
 */
async function transcribeAudio(audioBuffer, mimeType) {
    try {
        const buf = toBuffer(audioBuffer);
        const normalizedMime = normalizeMimeType(mimeType);

        if (!buf || buf.length === 0) {
            return "❌ Invalid audio file received.";
        }
        if (!normalizedMime) {
            return "❌ MIME type missing or invalid.";
        }

        console.log("Transcribing audio with Gemini...");

        // Check supported formats
        if (!isFormatSupported(normalizedMime)) {
            return `❌ Unsupported audio format: ${normalizedMime}. Supported: ${getSupportedFormats().join(
                ", "
            )}`;
        }

        const transcription = await transcribeAudioWithGemini(buf, normalizedMime);

        // If the underlying function returns an object with text, extract it
        if (!transcription) return "❌ Audio transcription returned empty result.";

        if (typeof transcription === "string") return transcription;

        // try common fields
        if (typeof transcription.text === "string") return transcription.text;
        if (typeof transcription.transcript === "string") return transcription.transcript;
        if (typeof transcription.result === "string") return transcription.result;

        // fallback to JSON string
        return JSON.stringify(transcription);
    } catch (error) {
        console.error("Transcription error:", error);
        return "❌ Audio transcription failed. Please try again.";
    }
}

/**
 * Get supported audio formats for Gemini
 * @returns {Array} - List of supported MIME types
 */
function getSupportedFormats() {
    // include common aliases
    return [
        "audio/wav",
        "audio/x-wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/m4a",
        "audio/x-m4a",
        "audio/ogg",
        "audio/webm",
    ];
}

/**
 * Check if audio format is supported
 * @param {string} mimeType - The MIME type to check
 * @returns {boolean} - Whether the format is supported
 */
function isFormatSupported(mimeType) {
    if (!mimeType || typeof mimeType !== "string") return false;
    const normalized = normalizeMimeType(mimeType);
    const supported = getSupportedFormats();
    // match by exact or startsWith (some user agents include codecs params)
    return supported.some((fmt) => normalized === fmt || normalized.startsWith(fmt));
}

/**
 * Get transcription service status
 * @returns {Object} - Service status information
 */
function getTranscriptionStatus() {
    return {
        service: "Gemini Audio Processing",
        features: {
            transcription: "✅ Available",
            textToSpeech: "✅ Available",
            voiceSelection: "✅ Available",
        },
        supportedFormats: getSupportedFormats(),
        maxFileSize: "20MB",
        voiceTypes: ["male", "female"],
        integration: "✅ Gemini Multimodal API",
    };
}

module.exports = {
    processAudio,
    transcribeAudio,
    getSupportedFormats,
    isFormatSupported,
    getTranscriptionStatus,
};
