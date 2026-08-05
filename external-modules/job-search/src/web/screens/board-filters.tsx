import { h, type ReactNodeLike } from "../runtime";
import {
  EMPTY_BOARD_FILTERS,
  type BoardFilters,
  type FitFilter,
  type PostedFilter
} from "../board-types";

export function activeFilterCount(filters: BoardFilters): number {
  return Object.entries(filters).filter(([key, value]) => {
    const empty = EMPTY_BOARD_FILTERS[key as keyof BoardFilters];
    return typeof value === "string" ? value.trim() !== empty : value !== empty;
  }).length;
}

export function BoardFilterRow(props: {
  filters: BoardFilters;
  sources: readonly string[];
  onChange(filters: BoardFilters): void;
}): ReactNodeLike {
  const count = activeFilterCount(props.filters);
  const update = <Key extends keyof BoardFilters>(key: Key, value: BoardFilters[Key]): void => {
    props.onChange({ ...props.filters, [key]: value });
  };

  return (
    <fieldset className="jsm-filters">
      <legend className="jds-sr-only">Filter roles</legend>
      <label className="jsm-filter jsm-filter--wide">
        <span className="jds-eyebrow">Role or company</span>
        <input
          className="jds-input"
          type="search"
          value={props.filters.query}
          onChange={(event: { target: { value: string } }) => update("query", event.target.value)}
        />
      </label>
      <label className="jsm-filter">
        <span className="jds-eyebrow">Location</span>
        <input
          className="jds-input"
          type="search"
          value={props.filters.location}
          onChange={(event: { target: { value: string } }) =>
            update("location", event.target.value)
          }
        />
      </label>
      <label className="jsm-filter">
        <span className="jds-eyebrow">Posted</span>
        <select
          className="jds-select"
          value={props.filters.posted}
          onChange={(event: { target: { value: string } }) =>
            update("posted", event.target.value as PostedFilter)
          }
        >
          <option value="any">Any time</option>
          <option value="day">Past 24 hours</option>
          <option value="week">Past 7 days</option>
          <option value="month">Past 30 days</option>
        </select>
      </label>
      <label className="jsm-filter">
        <span className="jds-eyebrow">Fit</span>
        <select
          className="jds-select"
          value={props.filters.fit}
          onChange={(event: { target: { value: string } }) =>
            update("fit", event.target.value as FitFilter)
          }
        >
          <option value="any">Any fit</option>
          <option value="strong">Strong</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="weak">Weak</option>
          <option value="unscored">Not scored</option>
        </select>
      </label>
      <label className="jsm-filter">
        <span className="jds-eyebrow">Source</span>
        <select
          className="jds-select"
          value={props.filters.source}
          onChange={(event: { target: { value: string } }) => update("source", event.target.value)}
        >
          <option value="">All sources</option>
          {props.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      {count > 0 ? (
        <div className="jsm-filters__clear">
          <span className="jds-eyebrow">
            {count} {count === 1 ? "filter" : "filters"}
          </span>
          <button
            type="button"
            className="jds-btn jds-btn--quiet jds-btn--sm"
            onClick={() => props.onChange(EMPTY_BOARD_FILTERS)}
          >
            Clear
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
