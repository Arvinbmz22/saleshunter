"use client";

import { useState } from "react";
import { LeadCard } from "@/components/LeadCard";
import { LeadTable } from "@/components/LeadTable";
import { SearchDiagnosticsPanel } from "@/components/SearchDiagnostics";
import { SearchForm } from "@/components/SearchForm";
import { SearchStatus } from "@/components/SearchStatus";
import type { Lead, ProgressEvent, SearchStats } from "@/types/lead";

export default function HomePage() {
  const [category, setCategory] = useState("لوازم آرایشی");
  const [country, setCountry] = useState("ایران");
  const [city, setCity] = useState("تهران");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [open, setOpen] = useState<Lead | null>(null);

  async function start() {
    setRunning(true);
    setEvents([]);
    setError(null);
    setStats(null);
    setLeads([]);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, country, city, limit }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? "Request failed");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const event = chunk.match(/^event: (.+)$/m)?.[1];
          const dataLine = chunk.match(/^data: (.+)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine) as ProgressEvent & {
            leads?: Lead[];
            stats?: SearchStats;
            error?: string;
            code?: string;
          };
          if (event === "progress") setEvents((prev) => [...prev, data]);
          if (event === "complete") {
            setLeads(data.leads ?? []);
            setStats(data.stats ?? null);
          }
          if (event === "error") {
            setError({ message: data.error ?? "Search failed", code: data.code });
          }
        }
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="wrap">
      <h1>AdminExt AI Lead Finder</h1>
      <p className="sub">کشف لید B2B از منابع عمومی — کیفیت مهم‌تر از تعداد است. ورود به اینستاگرام یا ارسال پیام خودکار وجود ندارد.</p>
      {stats?.mockMode && (
        <div className="banner">حالت MOCK فعال است. نتایج نمونه برچسب‌خورده‌اند و جستجوی واقعی انجام نشده.</div>
      )}
      <SearchForm
        category={category}
        country={country}
        city={city}
        limit={limit}
        running={running}
        onChange={(patch) => {
          if (patch.category !== undefined) setCategory(patch.category);
          if (patch.country !== undefined) setCountry(patch.country);
          if (patch.city !== undefined) setCity(patch.city);
          if (patch.limit !== undefined) setLimit(patch.limit);
        }}
        onSubmit={start}
      />
      <SearchStatus running={running} events={events} />
      {error && (
        <div>
          <p className="error">{error.message}</p>
          {error.code === "SEARCH_PROVIDER_UNAVAILABLE" && (
            <p className="sub">
              هیچ لید ساختگی ساخته نشد. برای جستجوی واقعی باید یک فراهم‌کنندهٔ جستجو (
              <code>TAVILY_API_KEY</code>، <code>SERPER_API_KEY</code> یا <code>BRAVE_API_KEY</code>) تنظیم شود.
            </p>
          )}
        </div>
      )}
      {stats && (
        <div className="stats">
          <div className="stat">
            <span>لید جدید</span>
            <b>{stats.accepted}</b>
          </div>
          <div className="stat">
            <span>تکراری حذف‌شده</span>
            <b>{stats.duplicatesRemoved}</b>
          </div>
          <div className="stat">
            <span>نامرتبط حذف‌شده</span>
            <b>{stats.irrelevantRejected}</b>
          </div>
          <div className="stat">
            <span>رد به‌خاطر عدم احراز ایران</span>
            <b>{stats.iranRejected}</b>
          </div>
        </div>
      )}
      {stats?.search && <SearchDiagnosticsPanel diagnostics={stats.search} />}
      <LeadTable leads={leads} onOpen={setOpen} />
      {open && <LeadCard lead={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
