// Renders the PWA icons (an intensity silhouette on spruce) into public/icons.
// Run: npx tsx scripts/generate-icons.tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { ImageResponse } from "next/og";

const INK = "#14231D";
const BARS: [string, number][] = [
  ["#A9BCC6", 0.34],
  ["#6A9C86", 0.5],
  ["#E06C38", 0.86],
  ["#6A9C86", 0.5],
  ["#BE2F4B", 1],
  ["#A9BCC6", 0.34],
];

function Icon({ size, padding, transparent }: { size: number; padding: number; transparent?: boolean }) {
  const inner = size - padding * 2;
  const gap = inner * 0.05;
  const barWidth = (inner - gap * (BARS.length - 1)) / BARS.length;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap,
        padding,
        background: transparent ? "transparent" : INK,
      }}
    >
      {BARS.map(([color, h], i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: inner * 0.78 * h,
            marginBottom: inner * 0.11,
            background: transparent ? "#000" : color,
            borderRadius: barWidth * 0.18,
          }}
        />
      ))}
    </div>
  );
}

async function render(name: string, size: number, padding: number, transparent = false) {
  const img = new ImageResponse(<Icon size={size} padding={padding} transparent={transparent} />, {
    width: size,
    height: size,
  });
  writeFileSync(`public/icons/${name}`, Buffer.from(await img.arrayBuffer()));
  console.log("wrote", name);
}

async function main() {
  mkdirSync("public/icons", { recursive: true });
  await render("icon-192.png", 192, 30);
  await render("icon-512.png", 512, 80);
  await render("icon-maskable-512.png", 512, 120);
  await render("apple-touch-icon.png", 180, 28);
  await render("badge-96.png", 96, 10, true);
}

main();
