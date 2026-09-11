"use client";

import { FAILURE_PATTERN_LABELS, stopReasonLabel } from "@/lib/pipeline/labels";
import type { SearchDiagnostics } from "@/types/search";

const DIFFICULTY_LABEL: Record<string, string> = {
  EASY: "آسان",
  MEDIUM: "متوسط",
  HARD: "دشوار",
  VERY_HARD: "بسیار دشوار",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function SearchDiagnosticsPanel({ diagnostics }: { diagnostics: SearchDiagnostics }) {
  const topFamilies = diagnostics.familyStats.filter((stat) => stat.executed > 0).slice(0, 4);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>گزارش موتور جستجو</h3>
      <div className="stats">
        <Stat label="کوئری اجرا شده" value={`${diagnostics.queriesExecuted} از ${diagnostics.queriesGenerated}`} />
        <Stat label="دورهای جستجو" value={`${diagnostics.rounds} از ${diagnostics.maxRounds}`} />
        <Stat label="نتایج یکتا" value={diagnostics.uniqueResults} />
        <Stat label="کاندیداها" value={diagnostics.candidates} />
        <Stat label="تکراری تاریخی" value={diagnostics.historicalDuplicates} />
        <Stat label="رد اولیه (ارزان)" value={diagnostics.rejectedEarly} />
        <Stat label="سختی صنف" value={DIFFICULTY_LABEL[diagnostics.difficulty] ?? diagnostics.difficulty} />
        <Stat label="فراهم‌کننده" value={diagnostics.provider} />
      </div>

      <p className="sub" style={{ marginBottom: 6 }}>
        <b>علت توقف:</b> {stopReasonLabel(diagnostics.stopReason)}
      </p>
      {diagnostics.partialSearch && (
        <p className="banner" style={{ marginTop: 4 }}>
          جستجو ناتمام است: همهٔ کوئری‌های برنامه‌ریزی‌شده اجرا نشدند (خطا، محدودیت یا اتمام زمان
          فراهم‌کننده). نتایج زیر فقط بخشی از آنچه پیدا شده را نشان می‌دهد.
        </p>
      )}
      {diagnostics.mockMode && (
        <p className="banner" style={{ marginTop: 4 }}>
          حالت MOCK: این داده‌ها ساختگی و برچسب‌خورده‌اند و جایگزین جستجوی واقعی نیستند.
        </p>
      )}
      {diagnostics.failurePatterns.length > 0 && (
        <p className="sub" style={{ marginBottom: 6 }}>
          <b>الگوهای ضعف نتایج:</b>{" "}
          {diagnostics.failurePatterns.map((pattern) => FAILURE_PATTERN_LABELS[pattern] ?? pattern).join("، ")}
        </p>
      )}
      {diagnostics.providerErrors.length > 0 && (
        <p className="sub" style={{ marginBottom: 6 }}>
          <b>خطاهای فراهم‌کننده:</b> {diagnostics.providerErrors.join(" | ")}
        </p>
      )}
      {topFamilies.length > 0 && (
        <p className="sub" style={{ marginBottom: 0 }}>
          <b>عملکرد خانوادهٔ کوئری‌ها:</b>{" "}
          {topFamilies.map((stat) => `${stat.family} (${stat.newCandidates} کاندیدا / ${stat.executed} کوئری)`).join("، ")}
        </p>
      )}
      <p className="sub" style={{ marginBottom: 0, fontSize: 12 }}>
        اینترنت «به‌طور کامل» جستجو نشده است؛ فقط منابع و کوئری‌هایی که این موتور می‌شناسد.
      </p>
    </div>
  );
}
