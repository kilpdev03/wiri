import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const filled = ({ size = 16, ...rest }: IconProps) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  ...rest,
});

/** Icono de trazo a partir de una lista de paths (estilo Tabler). */
const stroke = (paths: string[], circles: [number, number, number][] = []) =>
  function StrokeIcon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {circles.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </svg>
    );
  };

export const PlayIcon = (p: IconProps) => (
  <svg {...filled(p)}><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
);

export const PauseIcon = (p: IconProps) => (
  <svg {...filled(p)}><rect x="5.5" y="4" width="4.5" height="16" rx="1.4" /><rect x="14" y="4" width="4.5" height="16" rx="1.4" /></svg>
);

const SKIP = "M2.5 6.2v11.6a.9.9 0 0 0 1.4.75L12 13v4.8a.9.9 0 0 0 1.4.75l8.6-5.8a.9.9 0 0 0 0-1.5l-8.6-5.8A.9.9 0 0 0 12 6.2V11L3.9 5.45a.9.9 0 0 0-1.4.75Z";

export const NextIcon = (p: IconProps) => (
  <svg {...filled(p)}><path d={SKIP} /></svg>
);

export const PrevIcon = (p: IconProps) => (
  <svg {...filled(p)} style={{ transform: "scaleX(-1)", ...p.style }}><path d={SKIP} /></svg>
);

export const TimerIcon = (p: IconProps) => (
  <svg {...filled(p)}><path d="M9 1.5h6v2H9zM12 4.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm1 8.6V8h-2v5.9l3.7 2.6 1.15-1.64Z" /></svg>
);

export const HomeIcon = stroke(["M5 12H3l9-9 9 9h-2", "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7", "M10 21v-5h4v5"]);
export const MusicIcon = stroke(["M9 17V4h10v11", "M9 8h10"], [[6, 17, 3], [16, 15, 3]]);
export const MailIcon = stroke(["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "m3 7 9 6 9-6"]);
export const BellIcon = stroke([
  "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6",
  "M9 17v1a3 3 0 0 0 6 0v-1",
]);
export const ChatIcon = stroke([
  "M8 9h8",
  "M8 13h6",
  "M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
]);
export const SlidersIcon = stroke(["M4 6h8", "M16 6h4", "M4 12h2", "M10 12h10", "M4 18h11", "M19 18h1"], [
  [14, 6, 2],
  [8, 12, 2],
  [17, 18, 2],
]);
export const PinIcon = stroke(["M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5-1.5l1.5-4l4-4", "M9 15l-4.5 4.5", "M14.5 4L20 9.5"]);
const SPEAKER = "M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15";
export const VolumeIcon = stroke(["M15 8a5 5 0 0 1 0 8", "M17.7 5a9 9 0 0 1 0 14", SPEAKER]);
export const VolumeOffIcon = stroke([SPEAKER, "M16 10l4 4", "M20 10l-4 4"]);
export const ShuffleIcon = stroke([
  "M18 4l3 3-3 3",
  "M18 20l3-3-3-3",
  "M3 7h3a5 5 0 0 1 5 5 5 5 0 0 0 5 5h5",
  "M21 7h-5a4.98 4.98 0 0 0-3 1",
  "M9 16a4.98 4.98 0 0 1-3 1H3",
]);
export const RepeatIcon = stroke(["M4 12V9a3 3 0 0 1 3-3h13", "M17 3l3 3-3 3", "M20 12v3a3 3 0 0 1-3 3H4", "M7 21l-3-3 3-3"]);
export const RepeatOnceIcon = stroke([
  "M4 12V9a3 3 0 0 1 3-3h13",
  "M17 3l3 3-3 3",
  "M20 12v3a3 3 0 0 1-3 3H4",
  "M7 21l-3-3 3-3",
  "M11 11l1-1v4",
]);
export const PlusIcon = stroke(["M12 5v14", "M5 12h14"]);
export const TrashIcon = stroke([
  "M4 7h16",
  "M10 11v6",
  "M14 11v6",
  "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12",
  "M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3",
]);
export const ExternalIcon = stroke(["M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6", "M11 13l9-9", "M15 4h5v5"]);
export const CheckIcon = stroke(["M5 12l5 5L20 7"]);
export const CloseIcon = stroke(["M18 6 6 18", "M6 6l12 12"]);
export const ClockIcon = stroke(["M12 7v5l3 3"], [[12, 12, 9]]);
export const CalendarIcon = stroke(["M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M16 3v4", "M8 3v4", "M4 11h16"]);
export const ChevronUpIcon = stroke(["M6 15l6-6 6 6"]);
export const ChevronDownIcon = stroke(["M6 9l6 6 6-6"]);
export const CopyIcon = stroke(["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]);
export const BubbleIcon = stroke(["M12 4c4.97 0 9 3.13 9 7s-4.03 7-9 7c-1.1 0-2.15-.15-3.12-.43L4 20l1.3-3.9C3.85 14.8 3 13 3 11c0-3.87 4.03-7 9-7z", "M8.5 11h.01", "M12 11h.01", "M15.5 11h.01"]);
export const DropIcon = stroke(["M12 3v12", "M7 10l5 5 5-5", "M5 21h14"]);
export const KeyboardIcon = stroke([
  "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
  "M6 10h0",
  "M10 10h0",
  "M14 10h0",
  "M18 10h0",
  "M7 14h10",
]);
export const VideoIcon = stroke(["M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14", "M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"]);
export const RefreshIcon = stroke(["M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"]);
export const HeadphonesIcon = stroke(["M4 15a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M15 15a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2z", "M4 15v-3a8 8 0 0 1 16 0v3"]);
export const MicIcon = stroke(["M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z", "M5 10a7 7 0 0 0 14 0", "M8 21h8", "M12 17v4"]);
export const MicOffIcon = stroke(["M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z", "M5 10a7 7 0 0 0 14 0", "M8 21h8", "M12 17v4", "M3 3l18 18"]);
export const CameraIcon = VideoIcon;
export const ClipboardIcon = stroke(["M9 4h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2", "M8 12h8", "M8 16h5"]);
export const BoltIcon = (p: IconProps) => (
  <svg {...filled(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
);
export const SparkIcon = (p: IconProps) => (
  <svg {...filled(p)}><path d="M12 2.5c.5 0 .9.35 1 .84l.72 3.86a4.2 4.2 0 0 0 3.08 3.08l3.86.72a1.02 1.02 0 0 1 0 2l-3.86.72a4.2 4.2 0 0 0-3.08 3.08L13 20.66a1.02 1.02 0 0 1-2 0l-.72-3.86a4.2 4.2 0 0 0-3.08-3.08L3.34 13a1.02 1.02 0 0 1 0-2l3.86-.72A4.2 4.2 0 0 0 10.28 7.2L11 3.34c.1-.49.5-.84 1-.84Z" /></svg>
);
export const SearchIcon = stroke(["M21 21l-6-6"], [[10, 10, 7]]);
export const ReplyIcon = stroke(["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"]);
