import { Cloud, CloudRain, CloudSnow, CloudSun, Sun, Wind } from "lucide-react";
import type { ComponentType } from "react";

import { DEMO_WEATHER, type WeatherIcon } from "./demo-data";

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
const TONE: Record<"amber" | "steel" | "slate", string> = {
  amber: "var(--amber)",
  steel: "var(--steel)",
  slate: "var(--ink-3)"
};

/**
 * Compact forecast for the top bar (the "header" weather placement).
 * Demo data for now — real location + forecast is tracked as roadmap work
 * (server-side IP-geo default + manual Settings override; browser geolocation
 * only works in a secure context, so it's a poor fit for plain-HTTP self-hosts).
 */
export function HeaderWeather() {
  const { place, days } = DEMO_WEATHER;
  const today = days[0];
  if (!today) return null;
  const Now = ICONS[today.icon];
  return (
    <div className="wx-mini">
      <span className="wx-mini__city">{place}</span>
      <div className="wx-mini__now">
        <Now size={20} color={TONE[today.tone]} />
        <span className="t">
          {today.hi}°<span className="lo"> {today.lo}°</span>
        </span>
      </div>
      <div className="wx-mini__days">
        {days.slice(1, 5).map((day) => {
          const Ico = ICONS[day.icon];
          return (
            <div className="wx-mini__day" key={day.d}>
              <span className="d">{day.d}</span>
              <Ico size={15} color={TONE[day.tone]} />
              <span className="t">{day.hi}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
