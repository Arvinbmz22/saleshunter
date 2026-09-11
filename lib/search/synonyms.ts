const SYNONYMS: { match: RegExp; terms: string[] }[] = [
  { match: /آرایشی|cosmetics|makeup|beauty/, terms: ["لوازم آرایشی", "آرایشی بهداشتی", "cosmetics", "makeup"] },
  { match: /پوشاک|لباس|clothing|fashion/, terms: ["پوشاک", "لباس", "بوتیک", "clothing"] },
  { match: /جواهر|طلا|jewelry/, terms: ["طلا و جواهر", "جواهرات", "jewelry"] },
  { match: /الکترونیک|موبایل|electronics/, terms: ["لوازم الکترونیکی", "موبایل", "electronics"] },
  { match: /غذا|رستوران|food|restaurant/, terms: ["رستوران", "غذای آماده", "سفارش غذا"] },
  { match: /مبل|furniture/, terms: ["مبلمان", "furniture"] },
  { match: /خودرو|automotive|قطعه/, terms: ["لوازم خودرو", "automotive"] },
  { match: /آموزش|education/, terms: ["آموزشگاه", "دوره آموزشی"] },
  { match: /پزشک|کلینیک|medical|زیبایی/, terms: ["کلینیک", "خدمات پزشکی", "خدمات زیبایی"] },
];

export function categoryVariants(category: string): string[] {
  const extra = SYNONYMS.find((s) => s.match.test(category))?.terms ?? [];
  return [...new Set([category, ...extra])].slice(0, 5);
}

export function cityAreaCode(city?: string): string | null {
  if (!city) return null;
  const table: Record<string, string> = {
    تهران: "021",
    tehran: "021",
    مشهد: "051",
    اصفهان: "031",
    شیراز: "071",
    تبریز: "041",
    کرج: "026",
  };
  const key = Object.keys(table).find((k) => city.toLowerCase().includes(k.toLowerCase()));
  return key ? table[key] : null;
}
