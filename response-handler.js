const configManager = require('./config-manager');
const apiManager = require('./api-manager');
const { generateResponse } = require('./gemini-config');
const fetch = require('node-fetch');

class ResponseHandler {
    constructor() {
        this.conversationContext = new Map(); // Store conversation context per user
    }

    /**
     * Main response handler that routes requests based on intent
     */
    async handleMessage(userId, message, mediaData = null) {
        try {
            // Update user's last active time
            configManager.getUserProfile(userId);
            
            // Detect intent from message
            const intentResult = apiManager.detectIntent(message);
            
            // Store conversation context
            this.updateContext(userId, message, intentResult.intent);
            
            // Route to appropriate handler
            switch (intentResult.intent) {
                case 'search':
                    return await this.handleSearch(userId, message);
                
                case 'weather':
                    return await this.handleWeather(userId, message);
                
                case 'translate':
                    return await this.handleTranslation(userId, message);
                
                case 'youtube_transcribe':
                    return await this.handleYouTubeTranscribe(userId, message);
                
                case 'youtube_summarize':
                    return await this.handleYouTubeSummarize(userId, message);
                
                case 'phone_lookup':
                    return await this.handlePhoneLookup(userId, message);
                
                case 'phone_info':
                    return await this.handlePhoneInfo(userId, message);
                
                default:
                    return await this.handleChat(userId, message, mediaData);
            }
        } catch (error) {
            console.error('Response handler error:', error);
            return {
                textResponse: '❌ Sorry, I encountered an error processing your request. Please try again.',
                audioResponse: null
            };
        }
    }

    /**
     * Handle search requests
     */
    async handleSearch(userId, message) {
        try {
            // Extract search query
            const query = this.extractSearchQuery(message);
            if (!query) {
                return {
                    textResponse: '❌ Please provide a search query. Example: "Search for latest AI news"',
                    audioResponse: null
                };
            }

            const searchResult = await apiManager.googleSearch(query, 5);
            
            if (searchResult.success && searchResult.results) {
                let response = `🔍 **Search Results for "${query}":**\n\n`;
                
                searchResult.results.slice(0, 5).forEach((result, index) => {
                    response += `${index + 1}. **${result.title}**\n`;
                    response += `   ${result.snippet}\n`;
                    response += `   🔗 ${result.link}\n\n`;
                });
                
                // Generate TTS if user prefers voice responses
                const audioResponse = await this.generateVoiceResponse(userId, `Found ${searchResult.results.length} search results for ${query}`);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: searchResult.summary || '❌ Search failed. Please try again.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Search error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle weather requests
     */
    async handleWeather(userId, message) {
        try {
            const location = this.extractLocation(message);
            if (!location) {
                return {
                    textResponse: '❌ Please specify a location. Example: "Weather in New York"',
                    audioResponse: null
                };
            }

            const weatherResult = await apiManager.getWeather(location);
            
            if (weatherResult.success && weatherResult.data) {
                const weather = weatherResult.data;
                let response = `🌤️ **Weather for ${location}:**\n\n`;
                
                if (weather.current) {
                    response += `**Current:** ${weather.current.condition}\n`;
                    response += `**Temperature:** ${weather.current.temperature}°C\n`;
                    response += `**Humidity:** ${weather.current.humidity}%\n`;
                    response += `**Wind:** ${weather.current.wind_speed} km/h\n\n`;
                }
                
                if (weather.forecast && weather.forecast.length > 0) {
                    response += `**Forecast:**\n`;
                    weather.forecast.slice(0, 3).forEach(day => {
                        response += `• ${day.date}: ${day.condition}, ${day.high}°/${day.low}°C\n`;
                    });
                }
                
                const audioResponse = await this.generateVoiceResponse(userId, weatherResult.summary);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: weatherResult.summary || '❌ Weather lookup failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Weather error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle translation requests
     */
    async handleTranslation(userId, message) {
        try {
            const { text, targetLang } = this.extractTranslationParams(message);
            if (!text) {
                return {
                    textResponse: '❌ Please provide text to translate. Example: "Translate hello to Spanish"',
                    audioResponse: null
                };
            }

            const translationResult = await apiManager.translateText(text, targetLang);
            
            if (translationResult.success) {
                const response = `🌐 **Translation:**\n\n**Original:** ${text}\n**Translated (${targetLang}):** ${translationResult.translatedText}`;
                const audioResponse = await this.generateVoiceResponse(userId, translationResult.summary);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: translationResult.summary || '❌ Translation failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Translation error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle YouTube transcription
     */
    async handleYouTubeTranscribe(userId, message) {
        try {
            const videoUrl = this.extractYouTubeUrl(message);
            if (!videoUrl) {
                return {
                    textResponse: '❌ Please provide a valid YouTube URL.',
                    audioResponse: null
                };
            }

            const transcribeResult = await apiManager.transcribeYouTube(videoUrl);
            
            if (transcribeResult.success) {
                const response = `📹 **YouTube Transcription:**\n\n${transcribeResult.transcript}`;
                const audioResponse = await this.generateVoiceResponse(userId, transcribeResult.summary);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: transcribeResult.summary || '❌ YouTube transcription failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ YouTube transcription error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle YouTube summarization
     */
    async handleYouTubeSummarize(userId, message) {
        try {
            const videoUrl = this.extractYouTubeUrl(message);
            if (!videoUrl) {
                return {
                    textResponse: '❌ Please provide a valid YouTube URL.',
                    audioResponse: null
                };
            }

            const summarizeResult = await apiManager.summarizeYouTube(videoUrl, 200);
            
            if (summarizeResult.success) {
                const response = `📹 **YouTube Summary:**\n\n${summarizeResult.summary}`;
                const audioResponse = await this.generateVoiceResponse(userId, `YouTube video summarized successfully`);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: summarizeResult.summary || '❌ YouTube summarization failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ YouTube summarization error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle phone lookup
     */
    async handlePhoneLookup(userId, message) {
        try {
            const phoneNumber = this.extractPhoneNumber(message);
            if (!phoneNumber) {
                return {
                    textResponse: '❌ Please provide a phone number. Example: "+1234567890"',
                    audioResponse: null
                };
            }

            const lookupResult = await apiManager.lookupPhone(phoneNumber);
            
            if (lookupResult.success) {
                const response = `📞 **Phone Lookup Results:**\n\n${JSON.stringify(lookupResult.data, null, 2)}`;
                const audioResponse = await this.generateVoiceResponse(userId, lookupResult.summary);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: lookupResult.summary || '❌ Phone lookup failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Phone lookup error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle phone info requests
     */
    async handlePhoneInfo(userId, message) {
        try {
            const phoneModel = this.extractPhoneModel(message);
            if (!phoneModel) {
                return {
                    textResponse: '❌ Please specify a phone model. Example: "iPhone 15 specs"',
                    audioResponse: null
                };
            }

            const infoResult = await apiManager.getPhoneInfo(phoneModel);
            
            if (infoResult.success) {
                const response = `📱 **Phone Specifications:**\n\n${JSON.stringify(infoResult.data, null, 2)}`;
                const audioResponse = await this.generateVoiceResponse(userId, infoResult.summary);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                return {
                    textResponse: infoResult.summary || '❌ Phone info lookup failed.',
                    audioResponse: null
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Phone info error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Handle regular chat with AI
     */
    async handleChat(userId, message, mediaData = null) {
        try {
            const userModel = configManager.getUserAIModel(userId);
            
            // Use the configured AI model
            if (userModel === 'gemini') {
                // Use existing Gemini integration
                const response = await generateResponse(message, mediaData);
                const audioResponse = await this.generateVoiceResponse(userId, response);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            } else {
                // Use external AI model
                const aiModels = configManager.getAIModels();
                const modelConfig = aiModels[userModel];
                
                if (!modelConfig) {
                    return {
                        textResponse: '❌ Selected AI model is not available. Please choose a different model.',
                        audioResponse: null
                    };
                }
                
                const response = await this.callExternalAI(modelConfig, message);
                const audioResponse = await this.generateVoiceResponse(userId, response);
                
                return {
                    textResponse: response,
                    audioResponse: audioResponse
                };
            }
        } catch (error) {
            return {
                textResponse: `❌ Chat error: ${error.message}`,
                audioResponse: null
            };
        }
    }

    /**
     * Call external AI models
     */
    async callExternalAI(modelConfig, message) {
        try {
            const url = `${modelConfig.endpoint}?prompt=${encodeURIComponent(message)}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            return data.response || data.answer || data.result || JSON.stringify(data);
        } catch (error) {
            throw new Error(`External AI call failed: ${error.message}`);
        }
    }

    /**
     * Generate voice response if user prefers it
     */
    async generateVoiceResponse(userId, text) {
        try {
            const profile = configManager.getUserProfile(userId);
            if (profile.voice_preference && text.length < 500) {
                const voice = configManager.getUserVoice(userId);
                const ttsResult = await apiManager.textToSpeech(text, voice);
                
                if (ttsResult.success) {
                    return ttsResult.audioBuffer;
                }
            }
        } catch (error) {
            console.error('Voice generation error:', error);
        }
        return null;
    }

    /**
     * Update conversation context
     */
    updateContext(userId, message, intent) {
        if (!this.conversationContext.has(userId)) {
            this.conversationContext.set(userId, []);
        }
        
        const context = this.conversationContext.get(userId);
        context.push({
            message: message,
            intent: intent,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 10 messages for context
        if (context.length > 10) {
            context.shift();
        }
    }

    /**
     * Extract search query from message
     */
    extractSearchQuery(message) {
        const patterns = [
            /search\s+(?:for\s+)?(.+)/i,
            /google\s+(.+)/i,
            /find\s+(.+)/i,
            /look\s+(?:up\s+)?(.+)/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
        
        return null;
    }

    /**
     * Extract location from weather message
     */
    extractLocation(message) {
        const patterns = [
            /weather\s+(?:in\s+|for\s+)?(.+)/i,
            /temperature\s+(?:in\s+|for\s+)?(.+)/i,
            /forecast\s+(?:in\s+|for\s+)?(.+)/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
        
        return null;
    }

    /**
     * Extract translation parameters
     */
    extractTranslationParams(message) {
        const patterns = [
            /translate\s+"?([^"]+)"?\s+to\s+(\w+)/i,
            /translate\s+(.+)\s+to\s+(\w+)/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return {
                    text: match[1].trim(),
                    targetLang: match[2].toLowerCase()
                };
            }
        }
        
        return { text: null, targetLang: 'en' };
    }

    /**
     * Extract YouTube URL
     */
    extractYouTubeUrl(message) {
        const patterns = [
            /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+)/i,
            /(https?:\/\/youtu\.be\/[\w-]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }

    /**
     * Extract phone number
     */
    extractPhoneNumber(message) {
        const pattern = /(\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})/;
        const match = message.match(pattern);
        return match ? match[1] : null;
    }

    /**
     * Extract phone model
     */
    extractPhoneModel(message) {
        const patterns = [
            /(?:specs|info|specifications)\s+(?:for\s+)?(.+)/i,
            /(.+)\s+(?:specs|info|specifications)/i
        ];
        
        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
        
        return null;
    }
}

module.exports = new ResponseHandler();

