import type { PipelineStage } from "@/types/lead";

export const STAGE_LABELS: Record<PipelineStage, string> = {
  generate_queries: "تولید کوئری‌ها",
  public_search: "جستجوی منابع عمومی",
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
