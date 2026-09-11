"use client";

import type { Lead } from "@/types/lead";

export function LeadCard({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h2>{lead.businessName ?? lead.username}</h2>
        <p>
          Iran verification: {lead.iranVerificationStatus} — confidence {lead.iranConfidence}%
        </p>
        <p>امتیاز کل: {lead.score} ({lead.tier})</p>
        <h3>چرا این لید</h3>
        <ul>
          {lead.reason.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <h3>شواهد ایران</h3>
        {lead.iranEvidence.map((e, i) => (
          <div className="ev" key={i}>
            [{e.strength}] {e.type}: {e.signal} {e.sourceUrl ? `— ${e.sourceUrl}` : ""}
          </div>
        ))}
        <h3>جزئیات امتیاز</h3>
        {Object.entries(lead.scoreBreakdown).map(([k, v]) => (
          <div className="ev" key={k}>
            {k}: {v}
          </div>
        ))}
        {lead.verificationWarnings.length > 0 && (
          <>
            <h3>هشدارها</h3>
            {lead.verificationWarnings.map((w) => (
              <div className="ev" key={w}>
                {w}
              </div>
            ))}
          </>
        )}
        {lead.rejectionReason && <p>رد: {lead.rejectionReason}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
