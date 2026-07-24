const fetch = require('node-fetch');
const configManager = require('./config-manager');

/**
 * Fetch today's top headlines from a free, no-API-key endpoint.
 * This is a community-hosted mirror, not an official paid news API -
 * like the other free mirrors in this project it can go down without
 * notice, so /status also checks it.
 */
async function fetchHeadlines(limit = 5) {
    const newsConfig = configManager.getNewsConfig();
    if (!newsConfig.enabled) {
        throw new Error('News feature is disabled in config.json');
    }

    const response = await fetch(newsConfig.endpoint, { timeout: 10000 });
    if (!response.ok) {
        throw new Error(`News API HTTP ${response.status}`);
    }

    const data = await response.json();
    const articles = data.articles || [];

    if (articles.length === 0) {
        throw new Error('No articles returned');
    }

    return articles.slice(0, limit);
}

/**
 * Build a WhatsApp-friendly text digest from headline articles.
 */
function formatDigest(articles) {
    let text = `📰 *Aaj ki Top News*\n\n`;
    articles.forEach((a, i) => {
        text += `${i + 1}. *${a.title}*\n`;
        if (a.description) text += `   ${a.description}\n`;
        if (a.url) text += `   🔗 ${a.url}\n`;
        text += `\n`;
    });
    text += `_Subscribed to daily news. Send /unsubscribe news to stop._`;
    return text;
}

/**
 * Send today's digest to every subscribed user, from the bot's own number.
 * Call this once a day (see scheduleDailyNews in index.js).
 */
async function broadcastDailyNews(sock) {
    const subscribers = configManager.getNewsSubscribers();
    if (subscribers.length === 0) return { sent: 0 };

    let articles;
    try {
        articles = await fetchHeadlines(5);
    } catch (error) {
        console.error('Daily news broadcast: fetching headlines failed:', error.message);
        return { sent: 0, error: error.message };
    }

    const digest = formatDigest(articles);
    let sent = 0;

    for (const userId of subscribers) {
        try {
            await sock.sendMessage(`${userId}@s.whatsapp.net`, { text: digest });
            sent++;
            // Small delay between sends so WhatsApp doesn't flag the number for spam-like bursts.
            await new Promise(r => setTimeout(r, 1500));
        } catch (error) {
            console.error(`Daily news send failed for ${userId}:`, error.message);
        }
    }

    return { sent, total: subscribers.length };
}

module.exports = {
    fetchHeadlines,
    formatDigest,
    broadcastDailyNews
};
