import { describe, expect, it } from "vitest";
import { verifyIran } from "@/lib/verification/iran";
import { candidate } from "./helpers";

const iran = { country: "ایران", city: "تهران" };

describe("Iran verification", () => {
  it("VERIFIED_IRAN for Tehran cosmetics with website+phone+address", () => {
    const result = verifyIran(
      candidate({
        username: "golboteh_beauty",
        instagramUrl: "https://www.instagram.com/golboteh_beauty",
        website: "https://golboteh.ir",
        sourceUrls: [
          "https://www.instagram.com/golboteh_beauty",
          "https://golboteh.ir",
        ],
        textBlob:
          "فروشگاه لوازم آرایشی تهران. آدرس خیابان ولیعصر تهران. تلفن ۰۲۱۸۸۷۷۶۶۵۵ و ۰۹۱۲۳۴۵۶۷۸۹. قیمت تومان. سایت golboteh.ir ارسال به سراسر ایران.",
      }),
      iran,
    );
    expect(result.status).toBe("VERIFIED_IRAN");
    expect(result.reject).toBe(false);
  });

  it("rejects Persian-only false positive", () => {
    const result = verifyIran(
      candidate({ textBlob: "سلام این یک صفحه فارسی درباره لوازم آرایشی است" }),
      iran,
    );
    expect(result.status).toBe("UNCERTAIN");
    expect(result.reject).toBe(true);
  });

  it("NOT_IRAN for Persian-speaking Turkish business", () => {
    const result = verifyIran(
      candidate({
        textBlob: "فروش لوازم آرایشی به زبان فارسی از استانبول ترکیه Istanbul Turkey",
      }),
      iran,
    );
    expect(result.status).toBe("NOT_IRAN");
    expect(result.reject).toBe(true);
  });

  it("NOT_IRAN for UAE store targeting Iranians", () => {
    const result = verifyIran(
      candidate({
        textBlob: "Dubai UAE cosmetics shipping to Iran فروش به مشتریان ایرانی از دبی",
      }),
      iran,
    );
    expect(result.status).toBe("NOT_IRAN");
  });

  it("NOT_IRAN for foreign company with Iranian followers", () => {
    const result = verifyIran(
      candidate({
        textBlob: "Los Angeles brand. Popular with Iranian followers. We mention Iran often.",
      }),
      iran,
    );
    expect(result.status).toBe("NOT_IRAN");
  });

  it("allows Iranian business on .com with local evidence", () => {
    const result = verifyIran(
      candidate({
        website: "https://zarnegar.com",
        instagramUrl: "https://www.instagram.com/zarnegar_esf",
        sourceUrls: [
          "https://www.instagram.com/zarnegar_esf",
          "https://zarnegar.com",
        ],
        textBlob:
          "طلافروشی اصفهان. آدرس میدان نقش جهان اصفهان. تلفن ۰۳۱۳۲۲۱۱۰۰. قیمت تومان. سایت zarnegar.com",
      }),
      { country: "ایران", city: "اصفهان" },
    );
    expect(result.status).toBe("VERIFIED_IRAN");
  });

  it("treats .ir as strong but still needs independent signals", () => {
    const weak = verifyIran(
      candidate({
        website: "https://random.ir",
        sourceUrls: ["https://random.ir"],
        textBlob: "a .ir page about cosmetics",
      }),
      iran,
    );
    expect(weak.status).not.toBe("VERIFIED_IRAN");
  });

  it("conflicting Instagram Tehran vs website Dubai is NOT_IRAN", () => {
    const result = verifyIran(
      candidate({
        instagramUrl: "https://www.instagram.com/shopx",
        website: "https://shopx.com",
        sourceUrls: ["https://www.instagram.com/shopx", "https://shopx.com"],
        textBlob: "Instagram: Tehran تهران. Official website: Dubai دبی UAE headquarters.",
      }),
      iran,
    );
    expect(result.status).toBe("NOT_IRAN");
    expect(result.warnings.join(" ")).toMatch(/Conflict|foreign|Conflicting/i);
  });

  it("weak public information stays UNCERTAIN", () => {
    const result = verifyIran(
      candidate({ textBlob: "برند ایرانی لوازم آرایشی" }),
      iran,
    );
    expect(result.status).toBe("UNCERTAIN");
    expect(result.reject).toBe(true);
  });

  it("does not count same-host snippets as independent", () => {
    const result = verifyIran(
      candidate({
        website: "https://shop.ir/about",
        sourceUrls: ["https://shop.ir/a", "https://shop.ir/b", "https://shop.ir/c"],
        textBlob: "فروشگاه تهران آدرس خیابان ولیعصر تهران تلفن ۰۲۱۸۸۷۷۶۶۵۵ تومان site shop.ir",
      }),
      iran,
    );
    const sources = new Set(result.evidence.map((e) => e.sourceId));
    expect(sources.size).toBeLessThanOrEqual(2);
  });

  it("city verification looks for requested city", () => {
    const result = verifyIran(
      candidate({
        instagramUrl: "https://www.instagram.com/x",
        website: "https://x.ir",
        sourceUrls: ["https://www.instagram.com/x", "https://x.ir"],
        textBlob: "فروشگاه مشهد. آدرس خیابان امام مشهد. تلفن ۰۵۱۳۲۲۱۱۰۹۹ تومان",
      }),
      { country: "ایران", city: "تهران" },
    );
    expect(result.evidence.some((e) => /Requested city/i.test(e.signal))).toBe(false);
  });
});
