"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LeadCard } from "@/components/LeadCard";
import { LeadTable } from "@/components/LeadTable";
import type { Lead } from "@/types/lead";

export default function PreviousLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads")
      .then(async (res) => {
        const body = (await res.json()) as { leads?: Lead[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "بارگذاری ناموفق بود");
        setLeads(body.leads ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "بارگذاری ناموفق بود"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="wrap">
      <h1>لیدهای قبلی</h1>
      <p className="sub">
        این‌ها لیدهایی هستند که قبلاً پیدا و ذخیره شده‌اند. در جستجوی جدید به‌خاطر تکراری بودن دوباره نشان داده نمی‌شوند.
      </p>
      <div className="actions" style={{ marginTop: 0, marginBottom: 18 }}>
        <Link href="/" className="btn-secondary">
          بازگشت به جستجو
        </Link>
      </div>
      {loading && <p className="sub">در حال بارگذاری...</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <>
          <div className="stats" style={{ gridTemplateColumns: "1fr" }}>
            <div className="stat">
              <span>تعداد لید ذخیره‌شده</span>
              <b>{leads.length}</b>
            </div>
          </div>
          <LeadTable leads={leads} onOpen={setOpen} />
        </>
      )}
      {open && <LeadCard lead={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
