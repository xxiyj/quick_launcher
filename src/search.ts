const COMMON_PINYIN_INITIALS: Record<string, string> = {
  微: "w",
  信: "x",
  钉: "d",
  企: "q",
  业: "y",
  腾: "t",
  讯: "x",
  会: "h",
  议: "y",
  网: "w",
  易: "y",
  云: "y",
  音: "y",
  乐: "y",
  百: "b",
  度: "d",
  盘: "p",
  浏: "l",
  览: "l",
  器: "q",
  谷: "g",
  歌: "g",
  火: "h",
  狐: "h",
  文: "w",
  件: "j",
  夹: "j",
  记: "j",
  事: "s",
  本: "b",
  画: "h",
  图: "t",
  计: "j",
  算: "s",
  机: "j",
  终: "z",
  端: "d",
  控: "k",
  制: "z",
  面: "m",
  板: "b",
  截: "j",
  屏: "p",
  工: "g",
  具: "j",
  设: "s",
  置: "z",
};

// GB2312 level-1 characters (码位 0xB0A1–0xD7F9) are sorted by pinyin, so the
// signed offset `code - 65536` falls into contiguous ranges per initial letter.
// These boundaries are the offset of the first character of each initial.
const PINYIN_BOUNDARIES: ReadonlyArray<readonly [number, string]> = [
  [-20319, "a"], [-20283, "b"], [-19775, "c"], [-19218, "d"], [-18710, "e"],
  [-18526, "f"], [-18239, "g"], [-17922, "h"], [-17417, "j"], [-16474, "k"],
  [-16212, "l"], [-15640, "m"], [-15165, "n"], [-14922, "o"], [-14914, "p"],
  [-14630, "q"], [-14149, "r"], [-14090, "s"], [-13318, "t"], [-12838, "w"],
  [-12556, "x"], [-11847, "y"], [-11055, "z"],
];

// Highest offset that still belongs to GB2312 level-1 (座, 0xD7F9). Level-2
// characters (0xD8xx+) are ordered by radical, not pinyin, so the boundary
// table does not apply to them.
const PINYIN_LEVEL1_MAX_OFFSET = 0xd7f9 - 65536;

// Reverse lookup char -> GB2312 code, built lazily from the GB2312 level-1 block.
// The browser (WebView2 / Chromium) can decode GB2312 but cannot encode it, so we
// decode every level-1 byte pair once to recover the true code point per character.
let gbLevel1Lookup: Map<string, number> | null | undefined;

function ensureGbLookup(): Map<string, number> | null {
  if (gbLevel1Lookup !== undefined) return gbLevel1Lookup;
  if (typeof TextDecoder === "undefined") {
    gbLevel1Lookup = null;
    return null;
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder("gb2312", { fatal: false });
  } catch {
    gbLevel1Lookup = null;
    return null;
  }
  const map = new Map<string, number>();
  const bytes = new Uint8Array(2);
  // Level-1 block: lead byte 0xB0–0xD7, trail byte 0xA1–0xFE.
  for (let hi = 0xb0; hi <= 0xd7; hi += 1) {
    for (let lo = 0xa1; lo <= 0xfe; lo += 1) {
      bytes[0] = hi;
      bytes[1] = lo;
      const char = decoder.decode(bytes);
      if (char.length === 1 && char !== "�" && !map.has(char)) {
        map.set(char, hi * 256 + lo);
      }
    }
  }
  gbLevel1Lookup = map;
  return map;
}

function pinyinInitial(char: string): string {
  const known = COMMON_PINYIN_INITIALS[char];
  if (known) return known;

  const code = char.charCodeAt(0);
  if (code < 0x4e00 || code > 0x9fff) return "";

  const gbCode = ensureGbLookup()?.get(char);
  if (gbCode == null) return "";

  const offset = gbCode - 65536;
  if (offset > PINYIN_LEVEL1_MAX_OFFSET) return "";
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i -= 1) {
    if (offset >= PINYIN_BOUNDARIES[i][0]) {
      return PINYIN_BOUNDARIES[i][1];
    }
  }
  return "";
}

export function buildSearchKey(name: string, extra = ""): string {
  const normalized = `${name} ${extra}`.toLowerCase();
  const initials = Array.from(name)
    .map((char) => {
      if (/[a-z0-9]/i.test(char)) return char.toLowerCase();
      if (/\s|[-_.]/.test(char)) return " ";
      return pinyinInitial(char);
    })
    .join("");

  const wordInitials = normalized
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");

  return `${normalized} ${initials} ${wordInitials}`.replace(/\s+/g, " ").trim();
}

export function matchesSearch(name: string, searchKey: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle) || searchKey.includes(needle);
}
