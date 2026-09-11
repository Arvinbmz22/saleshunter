"use client";

import type { Lead } from "@/types/lead";

export function LeadTable({
  leads,
  onOpen,
}: {
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}) {
  if (!leads.length) return <p className="sub">هنوز لید جدیدی نیست.</p>;
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>ردیف</th>
            <th>نام کسب‌وکار</th>
            <th>Instagram</th>
            <th>شهر</th>
            <th>دسته‌بندی</th>
            <th>امتیاز</th>
            <th>سطح</th>
            <th>دلیل مناسب بودن</th>
            <th>لینک</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => (
            <tr key={`${lead.username}-${i}`}>
              <td>{i + 1}</td>
              <td>
                <button type="button" onClick={() => onOpen(lead)} style={{ background: "transparent", color: "inherit", padding: 0 }}>
                  {lead.businessName ?? "—"}
                </button>
              </td>
              <td>
                {lead.instagramUrl && lead.username ? (
                  <a href={lead.instagramUrl} target="_blank" rel="noreferrer">
                    @{lead.username}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td>{lead.city ?? "—"}</td>
              <td>{lead.category ?? "—"}</td>
              <td>{lead.score}</td>
              <td className={`tier ${lead.tier}`}>{lead.tier}</td>
              <td className="reason">{lead.reason[0] ?? "—"}</td>
              <td>
                {lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer">
                    سایت
                  </a>
                ) : lead.instagramUrl ? (
                  <a href={lead.instagramUrl} target="_blank" rel="noreferrer">
                    اینستاگرام
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
