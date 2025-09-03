const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor() {
        this.configPath = path.join(__dirname, 'config.json');
        this.userProfilesPath = path.join(__dirname, 'user_profiles.json');
        this.config = null;
        this.userProfiles = null;
        this.loadConfig();
        this.loadUserProfiles();
    }

    /**
     * Load main configuration from config.json
     */
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                this.config = JSON.parse(configData);
                console.log('✅ Configuration loaded successfully');
            } else {
                throw new Error('Configuration file not found');
            }
        } catch (error) {
            console.error('❌ Error loading configuration:', error);
            // Fallback to default configuration
            this.config = this.getDefaultConfig();
        }
    }

    /**
     * Load user profiles from user_profiles.json
     */
    loadUserProfiles() {
        try {
            if (fs.existsSync(this.userProfilesPath)) {
                const profileData = fs.readFileSync(this.userProfilesPath, 'utf8');
                this.userProfiles = JSON.parse(profileData);
            } else {
                this.userProfiles = {};
                this.saveUserProfiles();
            }
            console.log('✅ User profiles loaded successfully');
        } catch (error) {
            console.error('❌ Error loading user profiles:', error);
            this.userProfiles = {};
        }
    }

    /**
     * Save user profiles to file
     */
    saveUserProfiles() {
        try {
            fs.writeFileSync(this.userProfilesPath, JSON.stringify(this.userProfiles, null, 2));
        } catch (error) {
            console.error('❌ Error saving user profiles:', error);
        }
    }

    /**
     * Get configuration value by path (e.g., 'server.port')
     */
    get(path) {
        const keys = path.split('.');
        let value = this.config;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return null;
            }
        }
        
        return value;
    }

    /**
     * Get all available AI models
     */
    getAIModels() {
        return this.get('ai_models.available') || {};
    }

    /**
     * Get default AI model
     */
    getDefaultAIModel() {
        return this.get('ai_models.default') || 'gemini';
    }

    /**
     * Get available APIs
     */
    getAPIs() {
        return this.get('apis') || {};
    }

    /**
     * Get enabled APIs only
     */
    getEnabledAPIs() {
        const apis = this.getAPIs();
        const enabledAPIs = {};
        
        for (const [key, api] of Object.entries(apis)) {
            if (api.enabled) {
                enabledAPIs[key] = api;
            }
        }
        
        return enabledAPIs;
    }

    /**
     * Get user profile or create default one
     */
    getUserProfile(userId) {
        if (!this.userProfiles[userId]) {
            this.userProfiles[userId] = {
                ...this.get('user_profiles.default_profile'),
                created_at: new Date().toISOString(),
                last_active: new Date().toISOString()
            };
            this.saveUserProfiles();
        } else {
            // Update last active time
            this.userProfiles[userId].last_active = new Date().toISOString();
            this.saveUserProfiles();
        }
        
        return this.userProfiles[userId];
    }

    /**
     * Update user profile
     */
    updateUserProfile(userId, updates) {
        const profile = this.getUserProfile(userId);
        Object.assign(profile, updates);
        this.userProfiles[userId] = profile;
        this.saveUserProfiles();
        return profile;
    }

    /**
     * Get user's preferred AI model
     */
    getUserAIModel(userId) {
        const profile = this.getUserProfile(userId);
        return profile.preferred_ai_model || this.getDefaultAIModel();
    }

    /**
     * Set user's preferred AI model
     */
    setUserAIModel(userId, modelName) {
        const availableModels = this.getAIModels();
        if (availableModels[modelName]) {
            this.updateUserProfile(userId, { preferred_ai_model: modelName });
            return true;
        }
        return false;
    }

    /**
     * Get server configuration
     */
    getServerConfig() {
        return this.get('server') || { port: 3000, host: '0.0.0.0' };
    }

    /**
     * Check if a feature is enabled
     */
    isFeatureEnabled(featureName) {
        return this.get(`features.${featureName}`) || false;
    }

    /**
     * Get TTS voices
     */
    getTTSVoices() {
        return this.get('apis.tts.voices') || { female: ['Salli'], male: ['Matthew'] };
    }

    /**
     * Get user's preferred voice
     */
    getUserVoice(userId) {
        const profile = this.getUserProfile(userId);
        const voices = this.getTTSVoices();
        const preference = profile.voice_preference || 'female';
        
        if (voices[preference] && voices[preference].length > 0) {
            return voices[preference][0]; // Return first voice of preferred gender
        }
        
        // Fallback to any available voice
        const allVoices = Object.values(voices).flat();
        return allVoices[0] || 'Salli';
    }

    /**
     * Get default configuration (fallback)
     */
    getDefaultConfig() {
        return {
            server: { port: 3000, host: '0.0.0.0' },
            ai_models: {
                default: 'gemini',
                available: {
                    gemini: {
                        name: 'Google Gemini',
                        endpoint: 'internal',
                        description: 'Google\'s advanced AI model'
                    }
                }
            },
            apis: {},
            user_profiles: {
                default_profile: {
                    preferred_ai_model: 'gemini',
                    language: 'en',
                    voice_preference: 'female'
                }
            },
            features: {
                command_recognition: true,
                context_awareness: true
            }
        };
    }

    /**
     * Reload configuration from file
     */
    reload() {
        this.loadConfig();
        this.loadUserProfiles();
    }

    /**
     * Get configuration summary for status endpoint
     */
    getConfigSummary() {
        return {
            ai_models: Object.keys(this.getAIModels()).length,
            enabled_apis: Object.keys(this.getEnabledAPIs()).length,
            total_users: Object.keys(this.userProfiles).length,
            features_enabled: Object.values(this.get('features') || {}).filter(Boolean).length
        };
    }
}

// Export singleton instance
module.exports = new ConfigManager();

