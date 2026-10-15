import { ICONS, type IconName, type IconShape } from "./icons";

export interface IconProps {
  name: IconName;
  /** CSS pixels; multiples of 16 or 4 keep the pixels crisp. Default 16. */
  size?: number;
  /** Set for icons that carry meaning on their own; decorative icons stay hidden from screen readers. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 16, label, className }: IconProps) {
  const shape: IconShape = ICONS[name];
  if (!label) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        shapeRendering="crispEdges"
        focusable="false"
        aria-hidden="true"
        style={{ flex: "none" }}
      >
        <Paths shape={shape} />
      </svg>
    );
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      focusable="false"
      role="img"
      aria-label={label}
      style={{ flex: "none" }}
    >
      <title>{label}</title>
      <Paths shape={shape} />
    </svg>
  );
}

function Paths({ shape }: { shape: IconShape }) {
  return (
    <>
      {shape.layers ? shape.layers.map((l) => <path key={l.d} d={l.d} fill={l.fill} />) : <path d={shape.d} fillRule={shape.evenOdd ? "evenodd" : undefined} />}
    </>
  );
}
