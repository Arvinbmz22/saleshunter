import type { VerificationStatus } from "@/types/lead";
import type { Candidate } from "@/lib/search/discovery";

const REJECT_PATTERNS: { re: RegExp; reason: string; kind: string }[] = [
  { re: /پیج شخصی|personal (blog|account|page)|diary|خاطرات/, reason: "personal", kind: "personal" },
  { re: /meme|میم|fan page|فن پیج|طرفدار/, reason: "fan/meme", kind: "fan" },
  { re: /خبرگزاری|news|newspaper|اخبار/, reason: "news", kind: "news" },
  { re: /celebrity|سلبریتی|بازیگر|خواننده معروف/, reason: "celebrity", kind: "celebrity" },
  { re: /influencer|اینفلوئنسر(?! شاپ)/, reason: "influencer", kind: "influencer" },
  { re: /shopbot|ادمین‌اکس|adminext competitor/, reason: "competitor", kind: "competitor" },
];

export function verifyBusiness(candidate: Candidate): {
  status: VerificationStatus;
  confidence: number;
  reject: boolean;
  reason: string | null;
  commercialIntent: number;
} {
  const text = candidate.textBlob ?? "";
  for (const rule of REJECT_PATTERNS) {
    if (rule.re.test(text) && !/فروشگاه|سفارش|قیمت|کاتالوگ/.test(text)) {
      return {
        status: "REJECTED",
        confidence: 80,
        reject: true,
        reason: rule.reason,
        commercialIntent: 0,
      };
    }
  }

  const signals = [
    /فروشگاه|store|shop|بوتیک|برند/,
    /قیمت|price|تومان|سفارش/,
    /محصول|product|کاتالوگ|catalog/,
    /ارسال|shipping|پشتیبانی/,
    /واتساپ|تلگرام|دایرکت|whatsapp/,
    candidate.website ? /./ : /$a/,
  ];
  const hits = signals.filter((re) => re.test(text)).length;
  const commercialIntent = Math.min(100, hits * 16);
  if (hits < 2) {
    return {
      status: "REJECTED",
      confidence: 60,
      reject: true,
      reason: "insufficient commercial evidence",
      commercialIntent,
    };
  }
  return {
    status: hits >= 4 ? "VERIFIED" : "LIKELY",
    confidence: Math.min(90, 40 + hits * 10),
    reject: false,
    reason: null,
    commercialIntent,
  };
}
