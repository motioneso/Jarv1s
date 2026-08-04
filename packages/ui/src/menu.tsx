import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
}

export interface MenuProps {
  readonly triggerIcon: ReactNode;
  readonly triggerLabel: string;
  readonly items: readonly MenuItem[];
  readonly onSelect: (id: string) => void;
}

function isOutsideTarget(container: HTMLElement, target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return true;
  if (!("nodeType" in target)) return true;
  return !container.contains(target as Node);
}

export function Menu(props: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;

    function onPointerDown(event: PointerEvent) {
      if (container && isOutsideTarget(container, event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="jds-menu" ref={ref}>
      <button
        type="button"
        className="jds-menu__trigger"
        aria-label={props.triggerLabel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {props.triggerIcon}
      </button>
      {open ? (
        <div className="jds-menu__list" role="menu">
          {props.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                props.onSelect(item.id);
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
