import { Clock } from "lucide-react";

export function ComingSoon(props: { readonly title: string; readonly note: string }) {
  return (
    <div className="empty-state">
      <Clock size={22} aria-hidden="true" />
      <p>
        <strong>{props.title} is coming soon.</strong>
      </p>
      <p className="muted-text">{props.note}</p>
    </div>
  );
}
