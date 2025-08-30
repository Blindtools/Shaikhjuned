const fetch = require("node-fetch");

// Using OpenWeatherMap free API - you can get a free key at openweathermap.org
const OPENWEATHER_API_KEY = "b6907d289e10d714a6e88b30761fae22"; // Free demo key
const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

async function getCurrentWeather(city) {
    if (!city) {
        return "Please specify a city to get the weather information. E.g., \"weather in London\".";
    }

    try {
        const response = await fetch(`${OPENWEATHER_BASE_URL}?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=metric`);
        const data = await response.json();

        if (data.cod !== 200) {
            return `❌ Error: ${data.message}. Please check the city name and try again.`;
        }

        const weatherDescription = data.weather[0].description;
        const temperature = Math.round(data.main.temp);
        const feelsLike = Math.round(data.main.feels_like);
        const humidity = data.main.humidity;
        const windSpeed = data.wind.speed;
        const cityName = data.name;
        const country = data.sys.country;

        // Get weather emoji based on weather condition
        const weatherCode = data.weather[0].main.toLowerCase();
        let weatherEmoji = "☁️";
        if (weatherCode.includes("clear")) weatherEmoji = "☀️";
        else if (weatherCode.includes("rain")) weatherEmoji = "🌧️";
        else if (weatherCode.includes("snow")) weatherEmoji = "❄️";
        else if (weatherCode.includes("thunder")) weatherEmoji = "⛈️";
        else if (weatherCode.includes("cloud")) weatherEmoji = "☁️";
        else if (weatherCode.includes("mist") || weatherCode.includes("fog")) weatherEmoji = "🌫️";

        return `${weatherEmoji} *Current Weather in ${cityName}, ${country}:*\n\n` +
               `🌡️ Temperature: ${temperature}°C (feels like ${feelsLike}°C)\n` +
               `📝 Description: ${weatherDescription}\n` +
               `💧 Humidity: ${humidity}%\n` +
               `💨 Wind Speed: ${windSpeed} m/s\n\n` +
               `---\n💡 Powered by OpenWeatherMap & Shaikh Juned`;

    } catch (error) {
        console.error("Weather API error:", error);
        return "❌ Sorry, I couldn't retrieve weather information at the moment. Please try again later.\n\n🔧 If this persists, contact support at shaikhjuned.co.in";
    }
}

module.exports = {
    getCurrentWeather
};