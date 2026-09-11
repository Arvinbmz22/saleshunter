import type { FailurePattern, StopReason } from "@/types/search";
import type { PipelineStage as Stage } from "@/types/lead";

export const STAGE_LABELS: Record<Stage, string> = {
  generate_queries: "تولید کوئری‌ها",
  public_search: "جستجوی منابع عمومی",
  expanding_search: "گسترش جستجو",
  extract_candidates: "استخراج کاندیداها",
  iran_verification: "بررسی هویت ایرانی",
  business_verification: "بررسی کسب‌وکار",
  online_shop_verification: "بررسی فروش آنلاین",
  commercial_activity: "تحلیل فعالیت تجاری",
  shopbot_fit: "تحلیل ShopBot Fit",
  dedupe: "حذف تکراری‌ها",
  ranking: "رتبه‌بندی",
  finalize: "نهایی‌سازی",
};

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  ENOUGH_QUALIFIED_LEADS: "تعداد لیدهای باکیفیت درخواستی به دست آمد",
  SEARCH_BUDGET_EXHAUSTED: "سقف بودجه جستجو تمام شد",
  DIMINISHING_RETURNS: "کوئری‌های جدید تقریباً کاندیدای تازه‌ای نداشتند",
  NO_MORE_USEFUL_RESULTS: "کوئری مفید دیگری باقی نمانده بود",
  MAX_ROUNDS: "حداکثر دورهای جستجو انجام شد",
  TIME_BUDGET_EXHAUSTED: "زمان جستجو به پایان رسید",
  PROVIDER_LIMIT: "فراهم‌کننده جستجو محدودیت درخواست اعمال کرد",
  PROVIDER_FAILURE: "خطا در فراهم‌کننده جستجو",
  NO_RESULTS: "هیچ نتیجه‌ای از منابع عمومی به دست نیامد",
};

export const FAILURE_PATTERN_LABELS: Record<FailurePattern, string> = {
  TOO_MANY_PERSONAL: "نتایج زیادی شخصی بودند",
  TOO_MANY_FOREIGN: "نتایج زیادی خارج از کشور بودند",
  TOO_MANY_DUPLICATES: "بخش زیادی از نتایج تکراری بود",
  TOO_MANY_NEWS: "نتایج زیادی خبری/مقاله بودند",
  TOO_MANY_FAN_PAGES: "نتایج زیادی فن‌پیج بودند",
  TOO_FEW_BUSINESSES: "کسب‌وکار کافی پیدا نشد",
  TOO_FEW_IRANIAN_RESULTS: "شواهد ایرانی کافی نبود",
  TOO_FEW_CITY_MATCHES: "نتایج کافی برای شهر درخواستی نبود",
  TOO_FEW_COMMERCIAL_RESULTS: "نتایج تجاری کافی نبود",
  LOW_CATEGORY_RELEVANCE: "ارتباط نتایج با صنف کم بود",
};

export function stopReasonLabel(reason: StopReason | null | undefined): string {
  if (!reason) return "علت توقف ثبت نشده";
  return STOP_REASON_LABELS[reason] ?? reason;
}
