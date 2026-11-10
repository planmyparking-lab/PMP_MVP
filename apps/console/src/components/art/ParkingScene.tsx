/**
 * Decorative top-down parking lot in the brand palette. Pure SVG (no network images, no licensing questions).
 * It is artwork only: it shows no facility's data.
 */

const SLOT = 64;
const LEFT = 32;
const TOP_ROW = [1, 1, 0, 1, 2, 1, 0, 1, 1];
const BOTTOM_ROW = [1, 0, 1, 1, -1, 1, 2, 1, 0];
const SHADES = ["#2b3326", "#353f2f", "#3f4a37", "#4a5541"];

function Car({
  x,
  y,
  colour,
  glow,
  facing,
}: {
  x: number;
  y: number;
  colour: string;
  glow?: boolean;
  facing: "down" | "up";
}) {
  const front = facing === "down" ? y + 50 : y + 12;
  const rear = facing === "down" ? y + 14 : y + 56;
  return (
    <g>
      <rect x={x + 2} y={y + 4} width="40" height="78" rx="10" fill="#000" opacity="0.35" />
      <rect
        x={x}
        y={y}
        width="40"
        height="78"
        rx="10"
        fill={colour}
        stroke={glow ? "#e4ff8a" : "rgba(255,255,255,0.06)"}
        strokeWidth="1"
      />
      <rect x={x + 5} y={front} width="30" height="16" rx="5" fill={glow ? "#1d2410" : "#11140f"} />
      <rect x={x + 6} y={rear} width="28" height="9" rx="4" fill={glow ? "#1d2410" : "#11140f"} />
      <rect x={x + 7} y={y + 32} width="26" height="14" rx="3" fill="rgba(255,255,255,0.05)" />
    </g>
  );
}

export function ParkingScene({ id, className }: { id: string; className?: string }) {
  const target = { x: LEFT + 4 * SLOT, y: 284 };
  return (
    <svg
      viewBox="0 0 640 420"
      className={`parking-scene${className ? ` ${className}` : ""}`}
      role="img"
      aria-label="Illustration of a parking facility with a highlighted free slot"
    >
      <defs>
        <linearGradient id={`${id}-asphalt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#161a12" />
          <stop offset="1" stopColor="#0a0c08" />
        </linearGradient>
        <radialGradient id={`${id}-spot`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c6f61a" stopOpacity="0.45" />
          <stop offset="1" stopColor="#c6f61a" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-grain`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="rgba(255,255,255,0.025)" />
        </pattern>
      </defs>

      <rect width="640" height="420" rx="26" fill={`url(#${id}-asphalt)`} />
      <rect width="640" height="420" rx="26" fill={`url(#${id}-grain)`} />

      {/* slot lines */}
      <g stroke="rgba(255,255,255,0.14)" strokeWidth="2">
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i}>
            <line x1={LEFT + i * SLOT} y1="36" x2={LEFT + i * SLOT} y2="138" />
            <line x1={LEFT + i * SLOT} y1="282" x2={LEFT + i * SLOT} y2="384" />
          </g>
        ))}
        <line x1={LEFT} y1="36" x2={LEFT + 9 * SLOT} y2="36" />
        <line x1={LEFT} y1="384" x2={LEFT + 9 * SLOT} y2="384" />
      </g>

      {/* lane markings */}
      <line
        x1="40"
        y1="210"
        x2="600"
        y2="210"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="3"
        strokeDasharray="22 18"
      />
      <g fill="rgba(255,255,255,0.12)">
        <path d="M520 168 l18 10 -18 10 v-6 h-26 v-8 h26z" />
        <path d="M120 244 l-18 10 18 10 v-6 h26 v-8 h-26z" />
      </g>

      {/* cars */}
      {TOP_ROW.map((v, i) =>
        v > 0 ? (
          <Car
            key={`t${i}`}
            x={LEFT + i * SLOT + 12}
            y={48}
            colour={v === 2 ? "#c6f61a" : (SHADES[i % SHADES.length] ?? "#353f2f")}
            glow={v === 2}
            facing="down"
          />
        ) : null,
      )}
      {BOTTOM_ROW.map((v, i) =>
        v > 0 ? (
          <Car
            key={`b${i}`}
            x={LEFT + i * SLOT + 12}
            y={294}
            colour={v === 2 ? "#c6f61a" : (SHADES[(i + 2) % SHADES.length] ?? "#353f2f")}
            glow={v === 2}
            facing="up"
          />
        ) : null,
      )}

      {/* the free slot being guided to */}
      <circle cx={target.x + 32} cy={target.y + 50} r="70" fill={`url(#${id}-spot)`} />
      <rect
        x={target.x + 6}
        y={target.y + 6}
        width={SLOT - 12}
        height="90"
        rx="10"
        fill="rgba(198,246,26,0.08)"
        stroke="#c6f61a"
        strokeWidth="2"
        strokeDasharray="6 6"
        className="scene-slot"
      />

      {/* guided route from the gate */}
      <path
        d={`M 18 196 H ${target.x + 32} V ${target.y + 40}`}
        fill="none"
        stroke="#c6f61a"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="2 14"
        className="scene-route"
      />

      {/* car on its way */}
      <g className="scene-car">
        <rect x="70" y="174" width="78" height="40" rx="10" fill="#000" opacity="0.35" />
        <rect x="68" y="170" width="78" height="40" rx="10" fill="#e9ecef" />
        <rect x="120" y="175" width="16" height="30" rx="5" fill="#141812" />
        <rect x="76" y="176" width="10" height="28" rx="4" fill="#141812" />
        <rect x="146" y="176" width="4" height="8" rx="2" fill="#fff6a8" />
        <rect x="146" y="196" width="4" height="8" rx="2" fill="#fff6a8" />
      </g>

      {/* gate barrier */}
      <g>
        <rect x="6" y="150" width="12" height="20" rx="3" fill="#2b3326" />
        <rect x="14" y="156" width="4" height="70" rx="2" fill="#c6f61a" className="scene-boom" />
      </g>

      {/* pin marker */}
      <g className="scene-pin">
        <image
          href="/brand/mark-256.png"
          x={target.x + 4}
          y={target.y - 66}
          width="56"
          height="56"
        />
      </g>
    </svg>
  );
}
