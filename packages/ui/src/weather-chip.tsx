import { type ReactNode } from "react";

export interface WeatherChipProps {
  readonly city: ReactNode;
  readonly icon: ReactNode;
  readonly temp: ReactNode;
  readonly feelsLike?: ReactNode;
  readonly condition: ReactNode;
}

export function WeatherChip(props: WeatherChipProps) {
  return (
    <div className="jds-weather-chip">
      <span className="jds-weather-chip__city">{props.city}</span>
      <div className="jds-weather-chip__now">
        {props.icon}
        <span className="jds-weather-chip__temp">
          {props.temp}°
          {props.feelsLike != null ? (
            <span className="jds-weather-chip__feels"> {props.feelsLike}°</span>
          ) : null}
        </span>
      </div>
      <div className="jds-weather-chip__condition">{props.condition}</div>
    </div>
  );
}
