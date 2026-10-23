import localFont from "next/font/local";

/**
 * Self-hosted OFL subsets (see app/fonts/OFL.txt). Noto Sans is Latin plus the
 * precomposed pinyin vowels, about 10KB a weight. The SC faces cover the HSK
 * character set (about 3,000 hanzi) rather than every CJK slice: characters
 * outside that set use the system Chinese fonts in the fallback list.
 * CJK files are not preloaded; the browser fetches one only when that family
 * is used, and `display: swap` paints the fallback immediately.
 */
export const notoSans = localFont({
  src: [
    { path: "./fonts/noto-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/noto-sans-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  variable: "--font-sans",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const notoSansSc = localFont({
  src: "./fonts/noto-sans-sc-400.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-sans-sc",
  fallback: ["PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "sans-serif"],
});

export const notoSerifSc = localFont({
  src: "./fonts/noto-serif-sc-600.woff2",
  weight: "600",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-hanzi",
  fallback: ["Songti SC", "STSong", "Noto Serif CJK SC", "serif"],
});
