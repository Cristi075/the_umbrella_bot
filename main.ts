import { Logger, ILogObj } from "tslog";
import axios from 'axios';
import 'dotenv/config';

const logger: Logger<ILogObj> = new Logger();

const WEATHER_URL = (lat: string, lon: string, apiKey: string) => `https://api.openweathermap.org/data/2.5/forecast?units=metric&lat=${lat}&lon=${lon}&appid=${apiKey}`

// Based on https://openweathermap.org/forecast5
interface WeatherForecast {
    dt: Date;
    main: {
        temp: number;
        feels_like: number;
        temp_min: number;
        temp_max: number;
        humidity: number;
    };
    weather: {
        main: string;
        description: string;
    }[];
    pop: number; // Probability of precipitation
    dt_txt: string;
}

// Based on https://openweathermap.org/forecast5
interface WeatherApiResponse {
    cnt: number;
    list: WeatherForecast[];
}

export class UmbrellaBotService {

    // The main loop of the program, this is the method that will get called on a schedule
    public async main() {

        const forecasts = await this.getWeatherData();

        const rainDetected = forecasts.filter(f => f.weather[0].main.toLowerCase().indexOf('rain')>=0);
        logger.info(`Rain forecasted at ${rainDetected.length} moments`);
        const maxProbability = rainDetected.map(f=>f.pop).reduce((a, b) => Math.max(a, b), -Infinity);
        const maxProbabilityTimes = rainDetected.filter(f=> f.pop == maxProbability).map(f => f.dt_txt);
        logger.info(`Probability of rain: ${maxProbability}. At: ${maxProbabilityTimes}`)

        const maxTemperature = forecasts.map(f=>f.main.temp_max).reduce((a, b) => Math.max(a, b), -Infinity);
        const minTemperature = forecasts.map(f=>f.main.temp_min).reduce((a, b) => Math.min(a, b), +Infinity);

        let message: string = 'Good morning!\n\n';
        if (rainDetected.length >= 1){
            message += 'You should take your umbrella with you. ☔\n';
            message += 'There is rain forecasted for today. 🌧\n';
            message += `The highest probability of rain is ${maxProbability*100}%.\n`;
            message += `That is forecasted for ${maxProbabilityTimes}.\n`;
        } else {
            message += 'You can leave your umbrella at home today! 🌞\n';
            message += `It looks like it isn't going to rain.\n`
        }
        message += `\nThe temperature is going to be between ${minTemperature}°C and ${maxTemperature}°C.\n`
        message += '\nHave a nice day!'

        await this.sendWebhookMessage(message);
    }


    // Use this method to send a webhook-based message
    // This implementation uses Discord, but it is kept platform-agnostic since it doesn't use any
    // Discord-specific features like embeds
    // This means that you can easily adapt it to work with your messaging platform of choice
    private async sendWebhookMessage(message: string) {
        const webhook_url: string | undefined = process.env.WEBHOOK_URL;
        if (!webhook_url) {
            logger.error(`Invalid webhook URL: ${webhook_url}`)
            return;
        }

        const { data, status } = await axios.post<any>(
            webhook_url,
            {
                content: message
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        const response_body: string = JSON.stringify(data);
        logger.info(`Discord webhook response. Status code = ${status}. Response body = ${response_body}`);
    }

    // Returns the forecasts that are relevant for predicting today's weather
    // This assumes that the call is going to be made in the morning
    // A possible improvement would be to check each timestamp and only return those within the current day
    private async getWeatherData() {
        const latitude: string | undefined = process.env.LATITUDE;
        const longitude: string | undefined = process.env.LONGITUDE;
        const apiKey: string | undefined = process.env.OWM_API_KEY;
        if (!latitude || !longitude || !apiKey) {
            logger.error('Invalid environment vars: latitude/longitude/apiKey');
            return [];
        }

        const { data, status } = await axios.get<WeatherApiResponse>(
            WEATHER_URL(latitude, longitude, apiKey)
        );

        logger.info(`Weather API response. Status code = ${status}`);

        if (status != 200) {
            logger.error('Received non-200 status code')
            return [];
        }

        const allForecasts: WeatherForecast[] = data.list;
        if (!allForecasts || allForecasts.length == 0) {
            logger.error('Received empty response (no forecasts)')
            return [];
        }

        // I want this script to be run in the morning (6 or 7 AM)
        // So only the first 6 forecasts are relevant for today (each forecast is made for a 3h interval)
        const forecasts: WeatherForecast[] = allForecasts.splice(0, 6);

        return forecasts;
    }
}