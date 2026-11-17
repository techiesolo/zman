import { Children, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

interface SplitProps {
  direction: "row" | "column";
  /** Which pane has the stored size; the other one takes the rest. */
  fixed: "first" | "second";
  /** Pixels, or a fraction of the container when `unit` is "fraction". */
  size: number;
  unit: "px" | "fraction";
  min: number;
  max: number;
  onResize(size: number): void;
  children: ReactNode;
}

/** Two panes with a draggable divider between them. */
export function Split({ direction, fixed, size, unit, min, max, onResize, children }: SplitProps) {
  const container = useRef<HTMLDivElement>(null);
  const [first, second] = Children.toArray(children);
  const row = direction === "row";

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return;
      const total = row ? rect.width : rect.height;
      if (total <= 0) return;
      const offset = row ? ev.clientX - rect.left : ev.clientY - rect.top;
      const px = fixed === "first" ? offset : total - offset;
      onResize(Math.min(max, Math.max(min, unit === "px" ? px : px / total)));
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const basis = unit === "px" ? `${size}px` : `${size * 100}%`;
  const fixedStyle = { flex: `0 0 ${basis}` };
  const restStyle = { flex: "1 1 0" };

  return (
    <div ref={container} className={`flex min-h-0 min-w-0 flex-1 ${row ? "flex-row" : "flex-col"}`}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={fixed === "first" ? fixedStyle : restStyle}>
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        onPointerDown={startDrag}
        className={`group relative z-10 flex-none bg-line ${row ? "w-px cursor-col-resize" : "h-px cursor-row-resize"}`}
      >
        <div
          className={`absolute group-hover:bg-accent/40 ${row ? "inset-y-0 -left-[3px] w-[7px]" : "inset-x-0 -top-[3px] h-[7px]"}`}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={fixed === "second" ? fixedStyle : restStyle}>
        {second}
      </div>
    </div>
  );
}
