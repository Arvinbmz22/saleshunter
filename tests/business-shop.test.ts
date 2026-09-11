import { describe, expect, it } from "vitest";
import { verifyBusiness } from "@/lib/verification/business";
import { verifyOnlineShop } from "@/lib/verification/shop";
import { candidate } from "./helpers";

describe("Business verification", () => {
  it("accepts a real shop", () => {
    const r = verifyBusiness(
      candidate({
        website: "https://a.ir",
        textBlob: "فروشگاه لباس سفارش قیمت کاتالوگ ارسال پشتیبانی واتساپ",
      }),
    );
    expect(r.reject).toBe(false);
    expect(r.status).not.toBe("REJECTED");
  });

  it("rejects personal accounts", () => {
    expect(
      verifyBusiness(candidate({ textBlob: "پیج شخصی خاطرات روزانه makeup diary" })).reject,
    ).toBe(true);
  });

  it("rejects fan/news/influencer without shop signals", () => {
    expect(verifyBusiness(candidate({ textBlob: "fan page طرفدار" })).reason).toMatch(/fan/);
    expect(verifyBusiness(candidate({ textBlob: "خبرگزاری اخبار" })).reason).toMatch(/news/);
    expect(verifyBusiness(candidate({ textBlob: "influencer اینفلوئنسر" })).reject).toBe(true);
  });

  it("rejects insufficient evidence", () => {
    expect(verifyBusiness(candidate({ textBlob: "hello world" })).reason).toMatch(/insufficient/);
  });
});

describe("Shop verification", () => {
  it("detects online shop", () => {
    const r = verifyOnlineShop(
      candidate({
        website: "https://shop.ir",
        textBlob: "فروشگاه اینترنتی کاتالوگ محصول خرید آنلاین سفارش از دایرکت",
      }),
    );
    expect(r.reject).toBe(false);
  });

  it("does not treat Instagram presence alone as a shop", () => {
    const r = verifyOnlineShop(
      candidate({
        instagramUrl: "https://www.instagram.com/x",
        textBlob: "instagram.com page",
      }),
    );
    expect(r.reject).toBe(true);
  });

  it("rejects non-commercial pages", () => {
    expect(verifyOnlineShop(candidate({ textBlob: "poem blog" })).reject).toBe(true);
  });
});
