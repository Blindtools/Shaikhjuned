const fetch = require("node-fetch");

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

async function getCurrentWeather(city) {
    if (!OPENWEATHER_API_KEY) {
        return "❌ OpenWeather API key is not configured. Please set the OPENWEATHER_API_KEY environment variable.";
    }

    if (!city) {
        return "Please specify a city to get the weather information. E.g., \"weather in London\".";
    }

    try {
        const response = await fetch(`${OPENWEATHER_BASE_URL}?q=${city}&appid=${OPENWEATHER_API_KEY}&units=metric`);
        const data = await response.json();

        if (data.cod !== 200) {
            return `❌ Error: ${data.message}. Please check the city name.`;
        }

        const weatherDescription = data.weather[0].description;
        const temperature = data.main.temp;
        const feelsLike = data.main.feels_like;
        const humidity = data.main.humidity;
        const windSpeed = data.wind.speed;
        const cityName = data.name;
        const country = data.sys.country;

        return `☁️ *Current Weather in ${cityName}, ${country}:*\n` +
               `Description: ${weatherDescription}\n` +
               `Temperature: ${temperature}°C (feels like ${feelsLike}°C)\n` +
               `Humidity: ${humidity}%\n` +
               `Wind Speed: ${windSpeed} m/s\n\n` +
               `---\n💡 Powered by OpenWeatherMap`;

    } catch (error) {
        console.error("Weather API error:", error);
        return "❌ Sorry, I couldn't retrieve weather information at the moment. Please try again later.";
    }
}

module.exports = {
    getCurrentWeather
};

