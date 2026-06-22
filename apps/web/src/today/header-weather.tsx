import { Cloud, CloudRain, CloudSnow, CloudSun, Sun, Wind } from "lucide-react";
import type { ComponentType } from "react";
import type { WeatherTodayDto } from "@jarv1s/shared";

import type { WeatherIcon } from "./feed-source";
import "../styles/kit-weather.css";

const ICONS: Record<
  WeatherIcon,
  ComponentType<{ readonly size?: number; readonly color?: string }>
> = {
  sun: Sun,
  cloud: Cloud,
  "cloud-sun": CloudSun,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  wind: Wind
};

export function HeaderWeather(props: { readonly weather?: WeatherTodayDto | null }) {
  const wx = props.weather ?? null;
  if (!wx) return null;
  const Now = ICONS[wx.icon];
  return (
    <div className="wx-mini">
      <span className="wx-mini__city">{wx.location}</span>
      <div className="wx-mini__now">
        <Now size={20} color="var(--steel)" />
        <span className="t">
          {wx.temp}°<span className="lo"> {wx.feelsLike}°</span>
        </span>
      </div>
      <div className="wx-mini__condition">{wx.condition}</div>
    </div>
  );
}
