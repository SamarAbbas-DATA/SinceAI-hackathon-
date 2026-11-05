import type { SpaceType, Status } from "../engine/types";

// Vivid palette that reads well on both the dark and the light background.
// Red and amber are kept free for rule flags.
export const TYPE_COLOR: Record<SpaceType, string> = {
  cabin: "#38bdf8",
  corridor: "#94a3b8",
  stairwell: "#c084fc",
  lift: "#818cf8",
  public: "#a3e635",
  galley: "#facc15",
  engine_room: "#2dd4bf",
  store: "#d6b48a",
  muster_station: "#4ade80",
  tank: "#22d3ee",
  void: "#475569",
  other: "#e879f9",
};

export const TYPE_LABEL: Record<SpaceType, string> = {
  cabin: "Cabin",
  corridor: "Corridor",
  stairwell: "Stairwell",
  lift: "Lift",
  public: "Public space",
  galley: "Galley",
  engine_room: "Engine room",
  store: "Store",
  muster_station: "Assembly station",
  tank: "Tank",
  void: "Void",
  other: "Other",
};

/** 24x24 SVG path data for the build bar icons. */
export const TYPE_ICON: Record<SpaceType, string> = {
  cabin: "M4 18v-7h10a4 4 0 0 1 4 4v3M4 14h14M4 10V7",
  corridor: "M3 9h18M3 15h18M7 9v6M17 9v6",
  stairwell: "M4 20h4v-4h4v-4h4V8h4",
  lift: "M7 3h10v18H7zM10 9l2-2 2 2M10 15l2 2 2-2",
  public: "M4 20V10l8-6 8 6v10M9 20v-6h6v6",
  galley: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 2-2 6 0 8v10",
  engine_room: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  store: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  muster_station: "M12 3l9 5-9 5-9-5zM12 13v8M7 21h10",
  tank: "M5 6c0-2 14-2 14 0v12c0 2-14 2-14 0zM5 12c0 2 14 2 14 0",
  void: "M4 4h16v16H4zM4 4l16 16",
  other: "M12 5v14M5 12h14",
};

export const DEFAULT_SIZE: Record<SpaceType, [number, number]> = {
  cabin: [4, 4],
  corridor: [12, 2],
  stairwell: [4, 4],
  lift: [2, 2],
  public: [12, 8],
  galley: [8, 4],
  engine_room: [16, 9],
  store: [4, 4],
  muster_station: [12, 6],
  tank: [8, 6],
  void: [4, 4],
  other: [4, 4],
};

export const DEFAULT_PERSONS: Partial<Record<SpaceType, number>> = { cabin: 2, public: 20, galley: 4, engine_room: 2 };

/** Crisp status colours (CSS variables in the UI, hex for three.js and the PDF). */
export const STATUS_COLOR: Record<Status, string> = {
  red: "#e5484d",
  amber: "#e2a93b",
  green: "#46a758",
  grey: "#7a7774",
};
export const STATUS_VAR: Record<Status, string> = {
  red: "var(--bad)",
  amber: "var(--warn)",
  green: "var(--ok)",
  grey: "var(--faint)",
};
export const ACCENT = { dark: "#e0803c", light: "#c8611c" };

export const STATUS_LABEL: Record<Status, string> = {
  red: "Breaks the rule",
  amber: "Close to the limit",
  green: "Passes",
  grey: "Not enough built yet",
};

export const LSA_COLOR = { lifeboat: "#fb923c", liferaft: "#f8fafc" };
