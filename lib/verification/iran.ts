import type { EvidenceItem, IranVerificationStatus } from "@/types/lead";
import {
  containsForeignLocation,
  containsIranianCity,
  hasIranianCurrency,
  hasIranianPhone,
  hasPersianScript,
  hostnameOf,
} from "@/lib/leads/normalize";
import { independentSourceCount, independentSignals, makeEvidence } from "./evidence";
import type { Candidate } from "@/lib/search/discovery";

export type IranVerification = {
  status: IranVerificationStatus;
  score: number;
  confidence: number;
  evidence: EvidenceItem[];
  warnings: string[];
  reject: boolean;
  rejectionReason: string | null;
};

function cityMentioned(text: string, city?: string): boolean {
  if (!city) return false;
  return text.toLowerCase().includes(city.toLowerCase());
}

export function verifyIran(
  candidate: Candidate,
  opts: { country: string; city?: string },
): IranVerification {
  const countryIsIran = /ایران|iran/i.test(opts.country);
  if (!countryIsIran) {
    return {
      status: "NOT_APPLICABLE",
      score: 0,
      confidence: 0,
      evidence: [],
      warnings: [],
      reject: false,
      rejectionReason: null,
    };
  }

  const text = candidate.textBlob ?? "";
  const website = candidate.website ?? "";
  const host = hostnameOf(website);
  const evidence: EvidenceItem[] = [];
  const warnings: string[] = [];

  const persianOnly = hasPersianScript(text);
  const iranianCity = containsIranianCity(text);
  const requestedCity = cityMentioned(text, opts.city);
  const phone = hasIranianPhone(text);
  const currency = hasIranianCurrency(text);
  const irDomain = Boolean(host?.endsWith(".ir"));
  const foreign = containsForeignLocation(text);
  const iranWord = /ایران|iran/i.test(text);
  const shippingIran = /ارسال به سراسر ایران|ارسال به ایران|ارسال فوری تهران/.test(text);
  const addressLike = /آدرس|خیابان|میدان|پلاک/.test(text) && iranianCity;

  const instagramUrl =
    candidate.instagramUrl ??
    candidate.sourceUrls?.find((u) => /instagram\.com/i.test(u)) ??
    null;
  const websiteUrl = website || candidate.sourceUrls?.find((u) => !/instagram\.com/i.test(u)) || null;
  const otherUrl =
    candidate.sourceUrls?.find((u) => u !== instagramUrl && u !== websiteUrl) ?? null;

  if (requestedCity) {
    evidence.push(makeEvidence("public_profile", `Requested city (${opts.city}) mentioned`, instagramUrl, "moderate"));
  } else if (iranianCity) {
    evidence.push(makeEvidence("public_profile", "Iranian city mentioned", instagramUrl, "moderate"));
  }
  if (phone) {
    evidence.push(makeEvidence("public_contact", "Iranian phone number", websiteUrl ?? instagramUrl, "strong"));
  }
  if (currency) {
    evidence.push(makeEvidence("public_content", "Iranian currency (toman/rial)", instagramUrl ?? websiteUrl, "moderate"));
  }
  if (addressLike) {
    evidence.push(makeEvidence("public_profile", "Iranian street/address language with city", websiteUrl ?? instagramUrl, "strong"));
  }
  if (irDomain) {
    evidence.push(makeEvidence("official_website", ".ir domain", websiteUrl, "strong"));
  }
  if (websiteUrl && (iranianCity || phone || addressLike) && host && !host.endsWith(".ir")) {
    evidence.push(makeEvidence("official_website", "Non-.ir site with Iranian location/contact", websiteUrl, "moderate"));
  }
  if (shippingIran && (phone || addressLike || irDomain)) {
    evidence.push(makeEvidence("public_content", "Iran shipping plus local business signal", websiteUrl ?? instagramUrl, "moderate"));
  }
  if (otherUrl && (iranianCity || phone)) {
    evidence.push(makeEvidence("business_listing", "Independent public source with Iran location/contact", otherUrl, "moderate"));
  }

  const independent = independentSignals(evidence);
  const independentCount = independentSourceCount(independent);

  if (persianOnly && !iranianCity && !phone && !irDomain && !addressLike) {
    warnings.push("Persian language alone is not Iranian identity");
  }
  if (iranWord && !phone && !addressLike && !irDomain) {
    warnings.push("Mentioning Iran or appearing in an Iran search is not sufficient");
  }

  let status: IranVerificationStatus = "UNCERTAIN";
  if (foreign && !(phone && (addressLike || irDomain))) {
    status = "NOT_IRAN";
    warnings.push("Conflicting or foreign location evidence");
  } else if (independentCount >= 2 && (phone || addressLike || irDomain) && !foreign) {
    status = "VERIFIED_IRAN";
  } else if (independentCount >= 2 && iranianCity && (currency || shippingIran) && !foreign) {
    status = "LIKELY_IRAN";
  } else if (foreign) {
    status = "NOT_IRAN";
  } else if (independentCount <= 1) {
    status = "UNCERTAIN";
  }

  if (foreign && (iranianCity || requestedCity) && websiteUrl && /dubai|دبی|istanbul|استانبول|turkey|ترکیه/i.test(text)) {
    warnings.push("Conflicting location evidence; not resolved in favor of the requested country");
    status = "NOT_IRAN";
  }

  const scoreMap: Record<IranVerificationStatus, number> = {
    VERIFIED_IRAN: 90,
    LIKELY_IRAN: 70,
    UNCERTAIN: 30,
    NOT_IRAN: 0,
    NOT_APPLICABLE: 0,
  };
  const confidence =
    status === "VERIFIED_IRAN"
      ? Math.min(95, 55 + independentCount * 15)
      : status === "LIKELY_IRAN"
        ? Math.min(75, 40 + independentCount * 12)
        : status === "NOT_IRAN"
          ? 80
          : 25;

  const reject = status === "NOT_IRAN" || status === "UNCERTAIN";
  const exceptionalLikely =
    status === "LIKELY_IRAN" && independentCount >= 2 && (phone || irDomain);
  const shouldReject = reject || (status === "LIKELY_IRAN" && !exceptionalLikely);

  let rejectionReason: string | null = null;
  if (status === "NOT_IRAN") rejectionReason = "عدم احراز ایران / شواهد خارجی";
  if (status === "UNCERTAIN") rejectionReason = "شواهد ناکافی برای احراز ایران";
  if (status === "LIKELY_IRAN" && shouldReject) {
    rejectionReason = "احراز ایران فقط در حد محتمل است و برای پذیرش کافی نیست";
  }

  return {
    status,
    score: scoreMap[status],
    confidence,
    evidence: independent,
    warnings,
    reject: shouldReject,
    rejectionReason,
  };
}
