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

const PINYIN_BOUNDARIES = [
  [-20319, "a"], [-20283, "b"], [-19775, "c"], [-19218, "d"], [-18710, "e"],
  [-18526, "f"], [-18239, "g"], [-17922, "h"], [-17417, "j"], [-16474, "k"],
  [-16212, "l"], [-15640, "m"], [-15165, "n"], [-14922, "o"], [-14914, "p"],
  [-14630, "q"], [-14149, "r"], [-14090, "s"], [-13318, "t"], [-12838, "w"],
  [-12556, "x"], [-11847, "y"], [-11055, "z"],
] as const;

function gb2312Initial(char: string): string {
  const known = COMMON_PINYIN_INITIALS[char];
  if (known) return known;

  try {
    const encoded = new TextEncoder().encode(char);
    if (encoded.length < 2) return "";
  } catch {
    return "";
  }

  const code = char.charCodeAt(0);
  if (code < 0x4e00 || code > 0x9fff) return "";

  // Browser JavaScript does not expose GB2312 bytes. This range fallback keeps
  // search usable for common Chinese names without adding a heavy dependency.
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i -= 1) {
    if (code >= 0x4e00 + (PINYIN_BOUNDARIES[i][0] + 20319) / 5) {
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
      return gb2312Initial(char);
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
