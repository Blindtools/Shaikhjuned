const axios = require("axios");

async function getCurrentWeather(city) {
    try {
        const geoResponse = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${city}`);
        if (geoResponse.data.results && geoResponse.data.results.length > 0) {
            const location = geoResponse.data.results[0];
            const latitude = location.latitude;
            const longitude = location.longitude;
            const cityName = location.name;
            const country = location.country;

            const weatherResponse = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=celsius&windspeed_unit=kmh&precipitation_unit=mm`);
            const currentWeather = weatherResponse.data.current_weather;

            if (currentWeather) {
                return `Current weather in ${cityName}, ${country}:
Temperature: ${currentWeather.temperature}°C
Wind Speed: ${currentWeather.windspeed} km/h
Weather Code: ${currentWeather.weathercode}
`;
            } else {
                return `Could not retrieve current weather for ${cityName}, ${country}.`;
            }
        } else {
            return `Could not find location for ${city}. Please try a different city name.`;
        }
    } catch (error) {
        console.error("Weather API error:", error);
        return "Sorry, I couldn't fetch the weather information at the moment. Please try again later.";
    }
}

module.exports = {
    getCurrentWeather
};

