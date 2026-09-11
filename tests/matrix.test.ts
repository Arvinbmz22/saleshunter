import { describe, expect, it } from "vitest";
import { extractCandidates } from "@/lib/search/discovery";
import { MockSearchProvider } from "@/lib/search/provider";
import { analyzeActivity } from "@/lib/verification/activity";
import { verifyBusiness } from "@/lib/verification/business";
import { verifyIran } from "@/lib/verification/iran";
import { verifyOnlineShop } from "@/lib/verification/shop";
import { candidate } from "./helpers";

describe("realistic matrix", () => {
  it("mock discovery keeps quality-first rejects", async () => {
    const provider = new MockSearchProvider();
    const results = await provider.search('site:instagram.com "لوازم آرایشی" ایران');
    const candidates = extractCandidates(results);
    const decisions = candidates.map((c) => ({
      username: c.username,
      iran: verifyIran(c, { country: "ایران", city: "تهران" }),
      business: verifyBusiness(c),
      shop: verifyOnlineShop(c),
    }));
    const accepted = decisions.filter((d) => !d.iran.reject && !d.business.reject && !d.shop.reject);
    expect(accepted.some((d) => d.username === "golboteh_beauty")).toBe(true);
    expect(accepted.some((d) => d.username === "narin_beauty_tr")).toBe(false);
    expect(accepted.some((d) => d.username === "dubaiglow_cos")).toBe(false);
    expect(accepted.some((d) => d.username === "sara_makeup_diary")).toBe(false);
  });

  it("restaurant and service businesses can pass with commercial evidence", () => {
    const restaurant = candidate({
      username: "ashe_tehran",
      instagramUrl: "https://www.instagram.com/ashe_tehran",
      website: "https://ashe.ir",
      sourceUrls: ["https://www.instagram.com/ashe_tehran", "https://ashe.ir"],
      textBlob:
        "رستوران تهران آدرس خیابان ولیعصر تهران تلفن ۰۲۱۸۸۷۷۶۶۵۵ رزرو واتساپ منو سفارش آنلاین سایت ashe.ir تومان",
    });
    expect(verifyIran(restaurant, { country: "ایران", city: "تهران" }).status).toBe("VERIFIED_IRAN");
    expect(verifyBusiness(restaurant).reject).toBe(false);

    const service = candidate({
      username: "clinic_x",
      instagramUrl: "https://www.instagram.com/clinic_x",
      website: "https://clinicx.ir",
      sourceUrls: ["https://www.instagram.com/clinic_x", "https://clinicx.ir"],
      textBlob:
        "کلینیک زیبایی تهران آدرس میدان ونک تهران تلفن ۰۲۱۸۸۰۰۲۲۱۱ نوبت‌دهی مشاوره پشتیبانی سایت clinicx.ir تومان",
    });
    expect(verifyIran(service, { country: "ایران", city: "تهران" }).reject).toBe(false);
  });

  it("inactive business is marked inactive not invented", () => {
    const r = analyzeActivity(candidate({ textBlob: "این فروشگاه تعطیل شد و دیگر فعالیت نمی‌کند" }));
    expect(r.status).toBe("INACTIVE");
  });
});
