/**
 * The hero's city strip: one SVG that sits BELOW the hero text (never behind it) and fills the rest of the first
 * screen. A night skyline, an elevated metro whose train passes behind a multi-level car park, the car park's LED
 * board cycling through Console-style messages, and the approach road with a gate booth whose boom lifts.
 *
 * The drawing is 2400 units wide with the car park in the middle, scaled with "xMidYMax slice": the strip's full
 * height is always shown up to a 1920 px wide window, and a phone sees the centre (the car park and the gate).
 * Pure SVG and CSS animation, stopped under prefers-reduced-motion. Artwork only: it shows no facility's data.
 */

const W = 2400;
const ROAD_TOP = 222;
const PARK_TOP = 100;

/** [x, y, width, height] of the near buildings. */
const NEAR: [number, number, number, number][] = [
  [0, 120, 90, 110],
  [100, 60, 70, 170],
  [180, 140, 110, 90],
  [380, 90, 64, 140],
  [452, 150, 96, 80],
  [640, 40, 60, 190],
  [708, 110, 90, 120],
  [880, 130, 70, 100],
  [1440, 70, 70, 160],
  [1518, 130, 100, 100],
  [1700, 50, 56, 180],
  [1764, 120, 90, 110],
  [1960, 100, 80, 130],
  [2050, 150, 110, 80],
  [2250, 70, 70, 160],
  [2330, 130, 70, 100],
];

/** Windows: one or two per building, blinking in four phases. */
const WINDOWS: [number, number][] = NEAR.flatMap(([x, y, w, h], i) => {
  const first: [number, number] = [x + 14 + (i % 3) * 8, y + 22];
  return h > 120 ? [first, [x + w - 24, y + 64]] : [first];
});

const FAR: [number, number, number, number][] = [
  [40, 110, 50, 120],
  [300, 80, 60, 150],
  [560, 120, 70, 110],
  [820, 70, 50, 160],
  [960, 110, 70, 120],
  [1620, 90, 60, 140],
  [1870, 70, 70, 160],
  [2170, 100, 60, 130],
];

function Car({
  w,
  h,
  body,
  cabin,
  y,
  cls,
}: {
  w: number;
  h: number;
  body: string;
  cabin: string;
  y: number;
  cls: string;
}) {
  // Cars in the lower lane drive right to left, so they are mirrored to face the way they move.
  const flip = cls.includes("lp-car-rev");
  return (
    <g className={cls}>
      <g transform={flip ? `translate(${w} ${y}) scale(-1 1)` : `translate(0 ${y})`}>
        <rect x="3" y="4" width={w} height={h} rx={h / 3.2} fill="#000" opacity="0.35" />
        <rect width={w} height={h} rx={h / 3.2} fill={body} />
        <rect x={w * 0.58} y={h * 0.16} width={w * 0.26} height={h * 0.68} rx="5" fill={cabin} />
        <rect x={w - 4} y={h * 0.15} width="5" height={h * 0.2} rx="2" fill="#fff8c2" />
        <rect x={w - 4} y={h * 0.65} width="5" height={h * 0.2} rx="2" fill="#fff8c2" />
        <rect x="-2" y={h * 0.15} width="4" height={h * 0.2} rx="2" fill="#ff5a4e" opacity="0.8" />
        <rect x="-2" y={h * 0.65} width="4" height={h * 0.2} rx="2" fill="#ff5a4e" opacity="0.8" />
      </g>
    </g>
  );
}

/** Messages on the car park's LED board, in the Console's own vocabulary. */
export const LED_MESSAGES = ["ZONE B · 12 FREE", "ENTRY SYNCED ✓", "ZONE A · 4 FREE"] as const;

export function HeroScene() {
  return (
    <div className="lp-scene" aria-hidden="true">
      <svg viewBox={`0 0 ${W} 330`} preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="lp-bld" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#24321c" />
            <stop offset="1" stopColor="#111a0d" />
          </linearGradient>
          <linearGradient id="lp-beam" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#c6f61a" stopOpacity="0.32" />
            <stop offset="1" stopColor="#c6f61a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lp-park" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1f2b18" />
            <stop offset="1" stopColor="#151e10" />
          </linearGradient>
        </defs>

        {/* far skyline */}
        <g fill="#131c0f">
          {FAR.map(([x, y, w, h]) => (
            <rect key={`f${x}`} x={x} y={y} width={w} height={h} />
          ))}
        </g>
        {/* near skyline with blinking windows */}
        <g fill="url(#lp-bld)">
          {NEAR.map(([x, y, w, h]) => (
            <rect key={`n${x}`} x={x} y={y} width={w} height={h} />
          ))}
        </g>
        <g fill="#c6f61a">
          {WINDOWS.map(([x, y], i) => (
            <rect
              key={`w${x}-${y}`}
              x={x}
              y={y}
              width="8"
              height="8"
              className={`lp-win lp-win-${i % 4}`}
            />
          ))}
        </g>

        {/* elevated metro: the train runs behind the car park */}
        <rect x="0" y="182" width={W} height="10" fill="#2a3522" />
        <rect x="0" y="192" width={W} height="3" fill="#c6f61a" opacity="0.2" />
        <g fill="#1d2617">
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={`p${i}`} x={60 + i * 200} y="195" width="16" height={ROAD_TOP - 195} />
          ))}
        </g>
        <g className="lp-train">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={`t${i}`} transform={`translate(${i * 86} 152)`}>
              <rect width="82" height="30" rx={i === 4 ? 12 : 4} fill="#d8dfcd" />
              <rect y="21" width="82" height="3" fill="#c6f61a" />
              {[8, 30, 52].map((wx) => (
                <rect key={wx} x={wx} y="6" width="16" height="10" rx="2" fill="#2a3522" />
              ))}
            </g>
          ))}
        </g>

        {/* multi-level car park in the centre, with a searchlight, a lit P and an LED board */}
        {/* kept low in the drawing so a very wide window, which trims the top, never cuts the P sign */}
        <path d="M1202 76 L1150 22 L1254 22 Z" fill="url(#lp-beam)" className="lp-beam" />
        <rect
          x="1060"
          y={PARK_TOP}
          width="284"
          height={ROAD_TOP - PARK_TOP}
          fill="url(#lp-park)"
          stroke="rgba(198,246,26,0.25)"
        />
        <g fill="#0a1007">
          {[152, 174, 196].map((y) => (
            <rect key={`l${y}`} x="1074" y={y} width="256" height="16" />
          ))}
        </g>
        <g fill="#c6f61a" opacity="0.65">
          <rect x="1090" y="157" width="18" height="6" rx="2" />
          <rect x="1170" y="179" width="18" height="6" rx="2" />
          <rect x="1260" y="201" width="18" height="6" rx="2" />
          <rect x="1300" y="157" width="18" height="6" rx="2" />
          <rect x="1214" y="157" width="18" height="6" rx="2" />
        </g>
        <rect x="1182" y="58" width="40" height="40" rx="9" fill="#c6f61a" className="lp-psign" />
        <text
          x="1202"
          y="88"
          textAnchor="middle"
          fontFamily="Space Grotesk, sans-serif"
          fontWeight="700"
          fontSize="28"
          fill="#0b0d0a"
        >
          P
        </text>
        <g>
          <rect
            x="1086"
            y="110"
            width="232"
            height="32"
            rx="6"
            fill="#050805"
            stroke="rgba(198,246,26,0.4)"
          />
          {LED_MESSAGES.map((m, i) => (
            <text
              key={m}
              x="1202"
              y="132"
              textAnchor="middle"
              fontFamily="ui-monospace, Consolas, monospace"
              fontWeight="700"
              fontSize="16"
              letterSpacing="2"
              fill="#c6f61a"
              className={`lp-led lp-led-${i}`}
            >
              {m}
            </text>
          ))}
        </g>

        {/* road */}
        <rect x="0" y={ROAD_TOP} width={W} height={330 - ROAD_TOP} fill="#1a2016" />
        <rect x="0" y={ROAD_TOP} width={W} height="8" fill="#2a3323" />
        <rect x="0" y="322" width={W} height="8" fill="#2a3323" />
        <line
          x1="0"
          y1="276"
          x2={W}
          y2="276"
          stroke="#3b4731"
          strokeWidth="3"
          strokeDasharray="34 24"
        />

        {/* gate booth at the car park entrance, boom across the upper lane */}
        <rect
          x="1350"
          y="190"
          width="26"
          height="40"
          rx="4"
          fill="#2c3624"
          stroke="rgba(198,246,26,0.35)"
        />
        <rect x="1355" y="196" width="16" height="10" rx="2" fill="#c6f61a" opacity="0.9" />
        <g className="lp-boom">
          <rect x="1382" y="224" width="140" height="8" rx="3" fill="#c6f61a" />
          <g fill="#0b0d0a">
            {[1404, 1438, 1472].map((x) => (
              <rect key={`b${x}`} x={x} y="224" width="12" height="8" />
            ))}
          </g>
        </g>
        <circle cx="1382" cy="228" r="7" fill="#eef3e6" />

        <Car cls="lp-car" w={100} h={34} body="#c6f61a" cabin="#1d2410" y={238} />
        <Car
          cls="lp-car lp-car-2 lp-car-slow"
          w={150}
          h={38}
          body="#3f4a37"
          cabin="#11140f"
          y={236}
        />
        <Car cls="lp-car lp-car-3" w={90} h={32} body="#e8ece2" cabin="#11140f" y={240} />
        <Car cls="lp-car lp-car-rev" w={96} h={34} body="#353f2f" cabin="#11140f" y={284} />
        <Car
          cls="lp-car lp-car-rev lp-car-4 lp-car-slow"
          w={62}
          h={26}
          body="#9bc214"
          cabin="#1d2410"
          y={290}
        />
        <Car
          cls="lp-car lp-car-rev lp-car-5"
          w={110}
          h={36}
          body="#e8ece2"
          cabin="#11140f"
          y={283}
        />
      </svg>
    </div>
  );
}
