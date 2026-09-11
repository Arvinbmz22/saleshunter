import type { VerificationStatus } from "@/types/lead";
import type { Candidate } from "@/lib/search/discovery";

export function verifyOnlineShop(candidate: Candidate): {
  status: VerificationStatus;
  confidence: number;
  reject: boolean;
  reason: string | null;
  strength: number;
} {
  const text = candidate.textBlob ?? "";
  const catalog = /کاتالوگ|catalog|محصول|product page|فروشگاه اینترنتی/.test(text);
  const order = /سفارش|ثبت سفارش|خرید آنلاین|checkout|دایرکت.*سفارش|سفارش از دایرکت/.test(text);
  const chatOrder = /واتساپ|تلگرام|دایرکت|whatsapp|telegram/.test(text);
  const websiteShop = Boolean(candidate.website) && /فروش|shop|store|خرید/.test(text);

  const score =
    (catalog ? 30 : 0) + (order ? 30 : 0) + (chatOrder ? 20 : 0) + (websiteShop ? 20 : 0);

  if (score < 30) {
    return {
      status: "REJECTED",
      confidence: 55,
      reject: true,
      reason: "not an online-selling business",
      strength: score,
    };
  }

  return {
    status: score >= 60 ? "VERIFIED" : "LIKELY",
    confidence: Math.min(90, score),
    reject: false,
    reason: null,
    strength: score,
  };
}
