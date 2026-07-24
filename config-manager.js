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
     * Get user profile or create default one.
     * @param {string} userId
     * @param {string} [pushName] - WhatsApp display name, passed in on first contact
     * @returns {object} profile - profile.isNew is true only on the exact call that created it
     */
    getUserProfile(userId, pushName) {
        if (!this.userProfiles[userId]) {
            this.userProfiles[userId] = {
                ...this.get('user_profiles.default_profile'),
                name: pushName || 'friend',
                created_at: new Date().toISOString(),
                last_active: new Date().toISOString()
            };
            this.saveUserProfiles();
            return { ...this.userProfiles[userId], isNew: true };
        } else {
            // Backfill name if we didn't have it before, update last active time
            if (!this.userProfiles[userId].name && pushName) {
                this.userProfiles[userId].name = pushName;
            }
            this.userProfiles[userId].last_active = new Date().toISOString();
            this.saveUserProfiles();
        }

        return this.userProfiles[userId];
    }

    /**
     * All stored user IDs - used for broadcast and daily news sends.
     */
    getAllUserIds() {
        return Object.keys(this.userProfiles);
    }

    /**
     * User IDs who opted into the news subscription.
     */
    getNewsSubscribers() {
        return Object.entries(this.userProfiles)
            .filter(([, profile]) => profile.news_subscribed)
            .map(([userId]) => userId);
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
     * Conversation memory - last few turns per user, so replies stay
     * context-aware instead of treating every message as brand new.
     */
    addToHistory(userId, role, content) {
        const profile = this.getUserProfile(userId);
        if (!Array.isArray(profile.history)) profile.history = [];
        profile.history.push({ role, content });
        // Keep last 6 turns (3 user + 3 assistant) - enough context without
        // ballooning every request sent to the free model.
        if (profile.history.length > 6) {
            profile.history = profile.history.slice(-6);
        }
        this.userProfiles[userId] = profile;
        this.saveUserProfiles();
    }

    getHistory(userId) {
        const profile = this.getUserProfile(userId);
        return Array.isArray(profile.history) ? profile.history : [];
    }

    clearHistory(userId) {
        this.updateUserProfile(userId, { history: [] });
    }

    /**
     * Lightweight in-memory usage stats for the admin /stats command.
     * Resets on restart by design - this is a quick health signal, not an
     * analytics system.
     */
    incrementMessageCount() {
        this._stats = this._stats || { messages: 0, startedAt: new Date() };
        this._stats.messages++;
    }

    getStats() {
        this._stats = this._stats || { messages: 0, startedAt: new Date() };
        return {
            totalUsers: this.getAllUserIds().length,
            messagesSinceRestart: this._stats.messages,
            newsSubscribers: this.getNewsSubscribers().length,
            upSince: this._stats.startedAt.toISOString()
        };
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
     * Get developer/portfolio info (for the /hireme command)
     */
    getDeveloperInfo() {
        return this.get('developer') || {};
    }

    /**
     * Get news feature config
     */
    getNewsConfig() {
        return this.get('news') || { enabled: false };
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

