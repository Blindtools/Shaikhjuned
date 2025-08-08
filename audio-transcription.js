const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// Audio transcription configuration
const GOOGLE_SPEECH_API_KEY = "AIzaSyDRnmNVD_2dNTz3gvzTlfYKIeeo_VG10yU"; // Using same key as Gemini
const SPEECH_TO_TEXT_URL = "https://speech.googleapis.com/v1/speech:recognize";

/**
 * Transcribe audio using Google Speech-to-Text API
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @returns {Promise<string>} - The transcribed text
 */
async function transcribeAudioWithGoogle(audioBuffer, mimeType) {
    try {
        // Convert audio buffer to base64
        const audioBase64 = audioBuffer.toString('base64');
        
        // Determine audio encoding from MIME type
        let encoding = "WEBM_OPUS"; // Default for WhatsApp
        let sampleRateHertz = 16000;
        
        if (mimeType.includes('ogg')) {
            encoding = "OGG_OPUS";
        } else if (mimeType.includes('mp3')) {
            encoding = "MP3";
        } else if (mimeType.includes('wav')) {
            encoding = "LINEAR16";
            sampleRateHertz = 44100;
        } else if (mimeType.includes('m4a')) {
            encoding = "MP3"; // Fallback
        }
        
        const requestBody = {
            config: {
                encoding: encoding,
                sampleRateHertz: sampleRateHertz,
                languageCode: "en-US", // Primary language
                alternativeLanguageCodes: ["hi-IN", "ar-SA", "es-ES"], // Additional languages
                enableAutomaticPunctuation: true,
                enableWordTimeOffsets: false,
                model: "latest_long", // Better for longer audio
            },
            audio: {
                content: audioBase64
            }
        };
        
        console.log(`Transcribing audio: ${mimeType}, encoding: ${encoding}`);
        
        const response = await fetch(`${SPEECH_TO_TEXT_URL}?key=${GOOGLE_SPEECH_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
        if (result.error) {
            console.error("Speech-to-Text API Error:", result.error);
            return `❌ Transcription failed: ${result.error.message}`;
        }
        
        if (result.results && result.results.length > 0) {
            const transcript = result.results
                .map(r => r.alternatives[0].transcript)
                .join(' ');
            
            console.log("Transcription successful:", transcript.substring(0, 100) + "...");
            return transcript;
        } else {
            return "🔇 No speech detected in the audio. Please try speaking more clearly.";
        }
        
    } catch (error) {
        console.error("Transcription error:", error);
        return "❌ Audio transcription failed. Please try again or send a text message.";
    }
}

/**
 * Fallback transcription using a placeholder (for development)
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @returns {Promise<string>} - Placeholder transcribed text
 */
async function transcribeAudioFallback(audioBuffer, mimeType) {
    console.log(`Fallback transcription for ${mimeType}, size: ${audioBuffer.length} bytes`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return a helpful message
    return "🎵 Audio message received! However, audio transcription is currently in development. Please send your message as text for now, and I'll be happy to help you!";
}

/**
 * Main transcription function with fallback
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type of the audio
 * @param {boolean} useGoogleAPI - Whether to use Google Speech-to-Text API
 * @returns {Promise<string>} - The transcribed text
 */
async function transcribeAudio(audioBuffer, mimeType, useGoogleAPI = false) {
    try {
        // Validate audio buffer
        if (!audioBuffer || audioBuffer.length === 0) {
            return "❌ Invalid audio file received.";
        }
        
        // Check file size (limit to 10MB for API)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (audioBuffer.length > maxSize) {
            return "❌ Audio file too large. Please send a shorter audio message.";
        }
        
        // Log audio details
        console.log(`Processing audio: ${mimeType}, size: ${(audioBuffer.length / 1024).toFixed(2)}KB`);
        
        if (useGoogleAPI) {
            return await transcribeAudioWithGoogle(audioBuffer, mimeType);
        } else {
            return await transcribeAudioFallback(audioBuffer, mimeType);
        }
        
    } catch (error) {
        console.error("Audio processing error:", error);
        return "❌ Failed to process audio message. Please try again.";
    }
}

/**
 * Save audio file for debugging (optional)
 * @param {Buffer} audioBuffer - The audio buffer
 * @param {string} mimeType - The MIME type
 * @returns {Promise<string>} - File path where audio was saved
 */
async function saveAudioFile(audioBuffer, mimeType) {
    try {
        const extension = mimeType.includes('ogg') ? 'ogg' : 
                         mimeType.includes('mp3') ? 'mp3' : 
                         mimeType.includes('wav') ? 'wav' : 
                         mimeType.includes('m4a') ? 'm4a' : 'audio';
        
        const filename = `audio_${Date.now()}.${extension}`;
        const filepath = path.join(__dirname, 'temp', filename);
        
        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        fs.writeFileSync(filepath, audioBuffer);
        console.log(`Audio saved to: ${filepath}`);
        
        return filepath;
    } catch (error) {
        console.error("Error saving audio file:", error);
        return null;
    }
}

/**
 * Get supported audio formats
 * @returns {Array} - List of supported MIME types
 */
function getSupportedFormats() {
    return [
        'audio/ogg',
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/m4a',
        'audio/webm',
        'audio/opus'
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
        service: "Google Speech-to-Text API",
        apiKey: GOOGLE_SPEECH_API_KEY ? "✅ Configured" : "❌ Missing",
        supportedFormats: getSupportedFormats(),
        maxFileSize: "10MB",
        languages: ["en-US", "hi-IN", "ar-SA", "es-ES"],
        features: {
            punctuation: "✅ Enabled",
            multiLanguage: "✅ Enabled",
            longAudio: "✅ Supported"
        },
        fallbackMode: "✅ Available"
    };
}

module.exports = {
    transcribeAudio,
    transcribeAudioWithGoogle,
    transcribeAudioFallback,
    saveAudioFile,
    getSupportedFormats,
    isFormatSupported,
    getTranscriptionStatus
};

