// Shared form vocabulary (kept out of the "use server" actions file, which may only export functions).

export const PR_DISTANCES = [
  { key: "5k", label: "5K", distanceM: 5000 },
  { key: "10k", label: "10K", distanceM: 10000 },
  { key: "half", label: "Half marathon", distanceM: 21097 },
  { key: "marathon", label: "Marathon", distanceM: 42195 },
] as const;

export const GOAL_DISTANCES = {
  run: [
    { label: "5K", value: 5000 },
    { label: "10K", value: 10000 },
    { label: "Half marathon", value: 21097 },
    { label: "Marathon", value: 42195 },
  ],
  bike: [
    { label: "Gran fondo 100 km", value: 100000 },
    { label: "Gran fondo 160 km", value: 160000 },
    { label: "Time trial 40 km", value: 40000 },
  ],
} as const;
