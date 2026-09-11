const IRANIAN_CITIES = [
  "تهران",
  "tehran",
  "mashhad",
  "مشهد",
  "اصفهان",
  "isfahan",
  "esfahan",
  "شیراز",
  "shiraz",
  "تبریز",
  "tabriz",
  "کرج",
  "karaj",
  "قم",
  "qom",
  "اهواز",
  "ahvaz",
  "رشت",
  "rasht",
  "کرمان",
  "kerman",
  "یزد",
  "yazd",
  "ارومیه",
  "urmia",
  "همدان",
  "hamadan",
  "کرمانشاه",
  "kermanshah",
  "زاهدان",
  "zahedan",
  "اردبیل",
  "ardabil",
  "بندرعباس",
  "bandar abbas",
  "قزوین",
  "qazvin",
  "زنجان",
  "zanjan",
  "سنندج",
  "sanandaj",
  "گرگان",
  "gorgan",
  "ساری",
  "sari",
  "کیش",
  "kish",
];

const FOREIGN_LOCATION_MARKERS = [
  "dubai",
  "دبی",
  "uae",
  "الامارات",
  "istanbul",
  "استانبول",
  "turkey",
  "ترکیه",
  "ankara",
  "آنکارا",
  "los angeles",
  "london",
  "toronto",
  "vancouver",
  "germany",
  "berlin",
  "paris",
];

export function normalizeUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  value = value.replace(/^@+/, "");
  value = value.replace(/\/+$/, "");
  const instagramMatch = value.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-z0-9._]+)/i,
  );
  if (instagramMatch?.[1]) {
    value = instagramMatch[1].toLowerCase();
  }
  value = value.split("?")[0]?.split("/")[0] ?? value;
  value = value.replace(/[^a-z0-9._]/g, "");
  if (!value || value === "p" || value === "reel" || value === "stories") {
    return null;
  }
  return value;
}

export function normalizeInstagramUrl(raw: string | null | undefined): string | null {
  const username = normalizeUsername(raw);
  if (!username) return null;
  return `https://www.instagram.com/${username}`;
}

export function normalizeBusinessKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const value = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function sourceIdFor(url: string | null | undefined): string {
  return hostnameOf(url) ?? "unknown";
}

export function containsIranianCity(text: string): boolean {
  const lower = text.toLowerCase();
  return IRANIAN_CITIES.some((city) => lower.includes(city.toLowerCase()));
}

export function containsForeignLocation(text: string): boolean {
  const lower = text.toLowerCase();
  return FOREIGN_LOCATION_MARKERS.some((marker) => lower.includes(marker));
}

export function hasIranianPhone(text: string): boolean {
  return /(?:\+98|0098|0?9\d{9}|021[\s-]?\d{8})/.test(text.replace(/[\s-]/g, ""));
}

export function hasIranianCurrency(text: string): boolean {
  return /تومان|ریال|toman|rial|irt\b/i.test(text);
}

export function hasPersianScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export const IRANIAN_CITIES_LIST = IRANIAN_CITIES;
