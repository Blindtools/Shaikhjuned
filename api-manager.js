const fetch = require('node-fetch');
const configManager = require('./config-manager');

class APIManager {
    constructor() {
        this.rateLimits = new Map(); // Simple rate limiting
    }

    /**
     * Check rate limit for API calls
     */
    checkRateLimit(apiName, maxRequests = 30, windowMs = 60000) {
        const now = Date.now();
        const key = apiName;
        
        if (!this.rateLimits.has(key)) {
            this.rateLimits.set(key, { count: 1, resetTime: now + windowMs });
            return true;
        }
        
        const limit = this.rateLimits.get(key);
        if (now > limit.resetTime) {
            this.rateLimits.set(key, { count: 1, resetTime: now + windowMs });
            return true;
        }
        
        if (limit.count >= maxRequests) {
            return false;
        }
        
        limit.count++;
        return true;
    }

    /**
     * Make HTTP request with error handling
     */
    async makeRequest(url, options = {}) {
        try {
            const response = await fetch(url, {
                timeout: 10000,
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            console.error(`API Request failed for ${url}:`, error.message);
            throw error;
        }
    }

    /**
     * Google Search API
     */
    async googleSearch(query, numResults = 5) {
        if (!this.checkRateLimit('google_search')) {
            throw new Error('Rate limit exceeded for Google Search');
        }

        const api = configManager.get('apis.google_search');
        if (!api || !api.enabled) {
            throw new Error('Google Search API is not enabled');
        }

        const url = `${api.endpoint}?q=${encodeURIComponent(query)}&num=${numResults}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                results: response.results || response,
                summary: `Found ${response.results?.length || 0} search results for "${query}"`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Search failed: ${error.message}`
            };
        }
    }

    /**
     * Weather API
     */
    async getWeather(location) {
        if (!this.checkRateLimit('weather')) {
            throw new Error('Rate limit exceeded for Weather API');
        }

        const api = configManager.get('apis.weather');
        if (!api || !api.enabled) {
            throw new Error('Weather API is not enabled');
        }

        try {
            // First, search for the city
            const searchUrl = `${api.endpoint}/search-city?query=${encodeURIComponent(location)}`;
            const cityData = await this.makeRequest(searchUrl);
            
            if (!cityData.success || !cityData.result || cityData.result.length === 0) {
                throw new Error('City not found');
            }

            const city = cityData.result[0];
            
            // Get weather data
            const weatherUrl = `${api.endpoint}/all-weather?lat=${city.lat}&lon=${city.lon}&key=weather`;
            const weatherData = await this.makeRequest(weatherUrl);
            
            if (!weatherData.success) {
                throw new Error('Weather data not available');
            }

            return {
                success: true,
                data: weatherData.result,
                summary: `🌤️ Weather for ${city.name}: ${weatherData.result.current?.condition || 'N/A'}, ${weatherData.result.current?.temperature || 'N/A'}°C`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Weather lookup failed: ${error.message}`
            };
        }
    }

    /**
     * Translation API
     */
    async translateText(text, targetLanguage = 'en') {
        if (!this.checkRateLimit('translator')) {
            throw new Error('Rate limit exceeded for Translation API');
        }

        const api = configManager.get('apis.translator');
        if (!api || !api.enabled) {
            throw new Error('Translation API is not enabled');
        }

        const url = `${api.endpoint}?text=${encodeURIComponent(text)}&target_language=${targetLanguage}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                translatedText: response.translatedText || response,
                summary: `🌐 Translated to ${targetLanguage}: ${response.translatedText || response}`
            };
        } catch (error) {
            // Try alternative translation service
            try {
                const altApi = configManager.get('apis.translator_alt');
                if (altApi && altApi.enabled) {
                    const altUrl = `${altApi.endpoint}?text=${encodeURIComponent(text)}&targetLang=${targetLanguage}`;
                    const altResponse = await this.makeRequest(altUrl);
                    return {
                        success: true,
                        translatedText: altResponse.translatedText || altResponse,
                        summary: `🌐 Translated to ${targetLanguage}: ${altResponse.translatedText || altResponse}`
                    };
                }
            } catch (altError) {
                console.error('Alternative translation also failed:', altError.message);
            }
            
            return {
                success: false,
                error: error.message,
                summary: `❌ Translation failed: ${error.message}`
            };
        }
    }

    /**
     * YouTube Transcription API
     */
    async transcribeYouTube(videoUrl) {
        if (!this.checkRateLimit('youtube_transcribe')) {
            throw new Error('Rate limit exceeded for YouTube Transcribe API');
        }

        const api = configManager.get('apis.youtube_transcribe');
        if (!api || !api.enabled) {
            throw new Error('YouTube Transcribe API is not enabled');
        }

        const url = `${api.endpoint}?url=${encodeURIComponent(videoUrl)}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                transcript: response.transcript || response,
                summary: `📹 YouTube video transcribed successfully`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ YouTube transcription failed: ${error.message}`
            };
        }
    }

    /**
     * YouTube Summarizer API
     */
    async summarizeYouTube(videoUrl, wordCount = 200) {
        if (!this.checkRateLimit('youtube_summarizer')) {
            throw new Error('Rate limit exceeded for YouTube Summarizer API');
        }

        const api = configManager.get('apis.youtube_summarizer');
        if (!api || !api.enabled) {
            throw new Error('YouTube Summarizer API is not enabled');
        }

        const url = `${api.endpoint}?url=${encodeURIComponent(videoUrl)}&wordCount=${wordCount}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                summary: response.summary || response,
                wordCount: wordCount
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ YouTube summarization failed: ${error.message}`
            };
        }
    }

    /**
     * Truecaller API
     */
    async lookupPhone(phoneNumber) {
        if (!this.checkRateLimit('truecaller')) {
            throw new Error('Rate limit exceeded for Truecaller API');
        }

        const api = configManager.get('apis.truecaller');
        if (!api || !api.enabled) {
            throw new Error('Truecaller API is not enabled');
        }

        const url = `${api.endpoint}?q=${encodeURIComponent(phoneNumber)}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                data: response,
                summary: `📞 Phone lookup completed for ${phoneNumber}`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Phone lookup failed: ${error.message}`
            };
        }
    }

    /**
     * Phone Info API
     */
    async getPhoneInfo(phoneModel) {
        if (!this.checkRateLimit('phone_info')) {
            throw new Error('Rate limit exceeded for Phone Info API');
        }

        const api = configManager.get('apis.phone_info');
        if (!api || !api.enabled) {
            throw new Error('Phone Info API is not enabled');
        }

        const url = `${api.endpoint}?query=${encodeURIComponent(phoneModel)}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                data: response,
                summary: `📱 Phone specifications found for ${phoneModel}`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Phone info lookup failed: ${error.message}`
            };
        }
    }

    /**
     * Image to PDF API
     */
    async imagesToPDF(imageUrls) {
        if (!this.checkRateLimit('image_to_pdf')) {
            throw new Error('Rate limit exceeded for Image to PDF API');
        }

        const api = configManager.get('apis.image_to_pdf');
        if (!api || !api.enabled) {
            throw new Error('Image to PDF API is not enabled');
        }

        const urlParam = Array.isArray(imageUrls) ? imageUrls.join(',') : imageUrls;
        const url = `${api.endpoint}?url=${encodeURIComponent(urlParam)}`;
        
        try {
            const response = await this.makeRequest(url);
            return {
                success: true,
                pdfUrl: response.pdfUrl || url, // The API returns the PDF directly
                summary: `📄 Images converted to PDF successfully`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Image to PDF conversion failed: ${error.message}`
            };
        }
    }

    /**
     * Text-to-Speech API
     */
    async textToSpeech(text, voice = 'Salli') {
        if (!this.checkRateLimit('tts')) {
            throw new Error('Rate limit exceeded for TTS API');
        }

        const api = configManager.get('apis.tts');
        if (!api || !api.enabled) {
            throw new Error('TTS API is not enabled');
        }

        const url = `${api.endpoint}?voice=${voice}&text=${encodeURIComponent(text)}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const audioBuffer = await response.buffer();
            return {
                success: true,
                audioBuffer: audioBuffer,
                summary: `🔊 Text converted to speech using ${voice} voice`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                summary: `❌ Text-to-speech failed: ${error.message}`
            };
        }
    }

    /**
     * Get API status for all enabled APIs
     */
    async getAPIStatus() {
        const enabledAPIs = configManager.getEnabledAPIs();
        const status = {};
        
        for (const [name, api] of Object.entries(enabledAPIs)) {
            try {
                // Simple health check - just try to reach the endpoint
                const response = await fetch(api.endpoint, { 
                    method: 'HEAD', 
                    timeout: 5000 
                });
                status[name] = {
                    status: response.ok ? '✅ Online' : '⚠️ Issues',
                    endpoint: api.endpoint,
                    description: api.description
                };
            } catch (error) {
                status[name] = {
                    status: '❌ Offline',
                    endpoint: api.endpoint,
                    description: api.description,
                    error: error.message
                };
            }
        }
        
        return status;
    }

    /**
     * Detect command intent from user message
     */
    detectIntent(message) {
        const lowerMessage = message.toLowerCase();
        
        // Search intent
        if (lowerMessage.includes('search') || lowerMessage.includes('google') || lowerMessage.includes('find')) {
            return { intent: 'search', confidence: 0.8 };
        }
        
        // Weather intent
        if (lowerMessage.includes('weather') || lowerMessage.includes('temperature') || lowerMessage.includes('forecast')) {
            return { intent: 'weather', confidence: 0.9 };
        }
        
        // Translation intent
        if (lowerMessage.includes('translate') || lowerMessage.includes('translation')) {
            return { intent: 'translate', confidence: 0.9 };
        }
        
        // YouTube intent
        if (lowerMessage.includes('youtube.com') || lowerMessage.includes('youtu.be')) {
            if (lowerMessage.includes('summarize') || lowerMessage.includes('summary')) {
                return { intent: 'youtube_summarize', confidence: 0.9 };
            } else {
                return { intent: 'youtube_transcribe', confidence: 0.8 };
            }
        }
        
        // Phone lookup intent
        if (lowerMessage.includes('phone number') || lowerMessage.includes('truecaller')) {
            return { intent: 'phone_lookup', confidence: 0.8 };
        }
        
        // Phone specs intent
        if (lowerMessage.includes('phone specs') || lowerMessage.includes('phone info')) {
            return { intent: 'phone_info', confidence: 0.8 };
        }
        
        return { intent: 'chat', confidence: 0.5 };
    }
}

module.exports = new APIManager();

