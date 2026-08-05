import { Cloud, CloudRain, CloudSnow, CloudSun, Sun, Wind } from "lucide-react";
import type { ComponentType } from "react";
import type { WeatherTodayDto } from "@jarv1s/shared";
import { WeatherChip } from "@jarv1s/ui";

import type { WeatherIcon } from "./feed-source";

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
    <WeatherChip
      city={wx.location}
      icon={<Now size={20} color="var(--steel)" />}
      temp={wx.temp}
      feelsLike={wx.feelsLike}
      condition={wx.condition}
    />
  );
}
