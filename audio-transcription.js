const { processAudioMessage, transcribeAudioWithGemini } = require("./gemini-config");

/**
 * Main audio processing function using Gemini
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @param {string} voiceType - Voice type for response (male/female)
 * @returns {Promise<Object>} - Processing result with text and audio response
 */
async function processAudio(audioBuffer, mimeType, voiceType = 'female') {
    try {
        // Validate audio buffer
        if (!audioBuffer || audioBuffer.length === 0) {
            return {
                success: false,
                textResponse: "❌ Invalid audio file received.",
                audioResponse: null
            };
        }
        
        // Check file size (limit to 20MB for Gemini)
        const maxSize = 20 * 1024 * 1024;
        if (audioBuffer.length > maxSize) {
            return {
                success: false,
                textResponse: "❌ Audio file too large. Please send a shorter audio message.",
                audioResponse: null
            };
        }
        
        console.log(`Processing audio: ${mimeType}, size: ${(audioBuffer.length / 1024).toFixed(2)}KB`);
        
        // Process with Gemini (transcribe + respond + TTS)
        return await processAudioMessage(audioBuffer, mimeType, voiceType);
        
    } catch (error) {
        console.error("Audio processing error:", error);
        return {
            success: false,
            textResponse: "❌ Failed to process audio message. Please try again.",
            audioResponse: null,
            error: error.message
        };
    }
}

/**
 * Transcribe audio only (without TTS response)
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(audioBuffer, mimeType) {
    try {
        console.log("Transcribing audio with Gemini...");
        return await transcribeAudioWithGemini(audioBuffer, mimeType);
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
    return [
        'audio/wav',
        'audio/mp3',
        'audio/mpeg',
        'audio/m4a',
        'audio/ogg',
        'audio/webm'
    ];
}

/**
 * Check if audio format is supported
 * @param {string} mimeType - The MIME type to check
 * @returns {boolean} - Whether the format is supported
 */
function isFormatSupported(mimeType) {
    const supportedFormats = getSupportedFormats();
    return supportedFormats.some(format => mimeType.includes(format.split('/')[1]));
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
            voiceSelection: "✅ Available"
        },
        supportedFormats: getSupportedFormats(),
        maxFileSize: "20MB",
        voiceTypes: ["male", "female"],
        integration: "✅ Gemini Multimodal API"
    };
}

module.exports = {
    processAudio,
    transcribeAudio,
    getSupportedFormats,
    isFormatSupported,
    getTranscriptionStatus
};

