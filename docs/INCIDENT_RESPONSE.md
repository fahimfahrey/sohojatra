# Incident Response Plan

Owner: Security Lead
Last reviewed: 2026-05-23
Review cadence: Quarterly (next: 2026-08-23)

This plan governs response to security incidents (breach, data exposure, account compromise, ransomware, DoS, insider misuse) and operational incidents with security implications. It defines phases, roles, communication channels, and evidence handling.

---

## 1. Roles

| Role | Primary | Backup | Responsibilities |
|------|---------|--------|------------------|
| Incident Commander (IC) | CTO | Engineering Lead | Owns the incident end-to-end. Declares severity. Makes go/no-go calls on containment actions. Single source of truth for status. Delegates everything else. |
| Security Lead | Security Lead | Senior Backend Eng | Threat analysis, IOC collection, forensics, eradication strategy, liaison with external IR firm if engaged. |
| Ops Lead | SRE/DevOps Lead | Platform Eng | Infrastructure containment (revoke keys, rotate secrets, isolate hosts, snapshot volumes), recovery rollout, monitoring. |
| Communications Lead | Head of Product | COO | Internal updates (Slack `#incident-<id>`), customer comms, regulatory notifications, status page. |
| Scribe | Assigned per incident | — | Real-time timeline in incident doc. Captures timestamps, decisions, commands run, hypotheses tested. |
| Legal/Privacy Counsel | External counsel | — | Engaged for SEV-1/SEV-2 and any incident with PII/PHI exposure. Advises on breach-notification obligations. |

**Rule:** IC does not perform technical work. IC coordinates. If IC must do hands-on work, hand off IC role.

---

## 2. Severity Classification

| Severity | Criteria | Response |
|----------|----------|----------|
| SEV-1 | Confirmed data breach, prod compromise, ransomware, customer PII exfiltration, full outage of auth/payments. | War room in 15 min. Exec notified. Legal engaged. 24/7 staffing until contained. |
| SEV-2 | Suspected compromise, partial system breach, single-tenant data exposure, credential leak, severe perf degradation under attack. | War room in 1 hour. Business-hours + on-call coverage. |
| SEV-3 | Suspicious activity, failed but credible attack attempt, vuln with active exploitation in wild, isolated misuse. | Triage within 4 hours business-day. |
| SEV-4 | Policy violation, low-risk anomaly, vuln without active exploit. | Triage within 1 business day. Track in ticket. |

IC may reclassify mid-incident as scope changes.

---

## 3. Phases

### 3.1 Detection

Sources:
- Sentry alerts (errors, anomalies) — see [docs/OBSERVABILITY.md](./OBSERVABILITY.md)
- Supabase auth logs and audit log (`src/lib/audit.ts`)
- WAF/CDN alerts (Vercel, Cloudflare)
- User reports → `security@<domain>`
- Bug bounty submissions
- Third-party threat intel (vendor breaches, leaked creds)
- Manual review during ops work

Any team member who observes a credible signal:
1. Open `#security-triage` Slack channel.
2. Post: signal, source, timestamp, link to evidence.
3. Tag `@security-oncall`.

On-call acknowledges within SLA (SEV-1: 15 min, SEV-2: 1 hr, SEV-3/4: next business day).

### 3.2 Triage & Declaration

On-call assesses:
- Real or false positive?
- Scope (systems, users, data classes affected)
- Severity per §2
- Whether to declare

If declared:
1. Assign incident ID `IR-YYYY-NN` (sequential).
2. Create Slack channel `#incident-ir-yyyy-nn` (private for SEV-1/2, restricted membership).
3. Open incident doc from template (timeline, hypothesis log, action log, decisions).
4. Assign IC, Security Lead, Ops Lead, Comms Lead, Scribe per §1.
5. Page execs per severity matrix.

### 3.3 Escalation

| Severity | Internal Notify | External Notify |
|----------|----------------|-----------------|
| SEV-1 | CEO, CTO, COO, Legal, all eng leads — within 30 min | Customers via status page within 1 hr (if customer-facing). Regulators per legal advice (GDPR: 72 hr, state breach laws vary). Law enforcement if criminal activity suspected. |
| SEV-2 | CTO, eng leads, Legal — within 1 hr | Affected customers within 24 hr if data exposure confirmed. |
| SEV-3 | Eng lead, Security Lead | Customer comms only if individual customer affected. |
| SEV-4 | Security Lead | None routine. |

Escalate up severity if scope grows. Do not escalate down without IC + Security Lead concurrence.

### 3.4 Containment

Goal: stop the bleeding without destroying evidence.

Short-term (minutes):
- Revoke compromised credentials (API keys, OAuth tokens, service accounts).
- Force logout affected user sessions via Supabase admin API.
- Rotate exposed secrets (env vars, signing keys, DB creds). Update via Vercel + Supabase dashboards.
- Block malicious IPs at CDN/WAF.
- Disable compromised user accounts (do not delete).
- Take affected hosts offline via firewall rules — do not power off (preserves volatile memory).
- Snapshot affected DB/volumes BEFORE remediation. Tag with incident ID.

Long-term (hours):
- Deploy patches behind feature flag.
- Tighten RLS policies if Supabase exposure.
- Add rate limits / additional auth.
- Network segmentation changes.

**Evidence preservation:** snapshot before mutating. Logs first. Memory dumps if SEV-1 host compromise. Chain-of-custody noted in incident doc (who touched what, when).

### 3.5 Eradication

- Identify root cause (not just symptom). Use 5-whys.
- Remove attacker persistence: scheduled tasks, added users, modified configs, planted webhooks/keys.
- Audit all systems touched by compromised credentials in the credential's lifetime window.
- Scan for IOCs across full estate.
- Patch the vulnerability that enabled entry.
- Verify malware/backdoor absence via fresh scans.

Eradication is not complete until Security Lead signs off in writing in the incident doc.

### 3.6 Recovery

- Restore from clean backups if data integrity compromised. Verify backup pre-dates intrusion.
- Bring services back gradually. Watch dashboards for re-compromise indicators.
- Re-enable disabled accounts after password reset + MFA enrollment.
- Issue new credentials to affected users via verified out-of-band channel.
- Monitor heightened for 30 days post-incident (custom Sentry rules, audit log alerts).
- IC declares incident "resolved" only when:
  - Eradication confirmed.
  - Services operating normally.
  - Monitoring in place.
  - Customer/regulator comms sent.

### 3.7 Post-Incident Review

Within 5 business days of resolution:
- Blameless postmortem meeting. IC chairs. All responders + relevant stakeholders attend.
- Document: timeline, root cause, what worked, what didn't, action items with owners and due dates.
- File postmortem in `docs/postmortems/IR-YYYY-NN.md`.
- Track action items to completion. Security Lead reviews monthly.
- Update this plan, runbooks, detection rules, training based on lessons learned.

For SEV-1/SEV-2: postmortem reviewed at next board meeting.

---

## 4. Communication

### Channels

- War room: `#incident-ir-yyyy-nn` Slack channel.
- Status updates: every 30 min for SEV-1, every 2 hr for SEV-2, EOD for SEV-3.
- External: status page (status.<domain>), email to affected customers, regulatory portals.
- All external comms reviewed by Comms Lead + Legal before publishing.

### Templates

Maintained in `docs/incident-templates/`:
- Initial customer notification
- Customer update
- Resolution notice
- Regulator notification (GDPR Art. 33, state AGs)
- Internal all-hands update

### Do not

- Discuss incident details in public Slack channels.
- Post screenshots of sensitive data in incident channel — link to access-controlled storage.
- Speculate publicly about cause or attribution before forensics complete.
- Promise specific remediation timelines before eradication confirmed.

---

## 5. Tools & Access

| Purpose | Tool |
|---------|------|
| Auth/session control | Supabase admin dashboard |
| Secret rotation | Vercel env vars, Supabase project settings |
| Logs | Sentry, Supabase logs, Vercel logs |
| Audit trail | `audit_log` table via `src/lib/audit.ts` |
| Communications | Slack, status page provider, email |
| Forensics | Volume snapshots (Supabase PITR), log exports |
| Ticketing | Jira (project: SEC) |
| Evidence storage | Access-controlled S3 bucket `s3://ir-evidence-<env>` |

Break-glass credentials stored in 1Password vault `IR-BreakGlass`. Access logged. Use only when normal access paths compromised.

---

## 6. Testing

Quarterly:
- Tabletop exercise simulating a SEV-1 or SEV-2 scenario (rotate scenario type: breach, ransomware, insider, supply chain, DoS).
- All on-call responders participate. Exec sponsor observes.
- Measure: time-to-declare, time-to-contain, comms clarity, doc completeness.
- Outcomes recorded in `docs/ir-drills/YYYY-QN.md`. Gaps become action items.

Annually:
- Full plan review and update.
- Verify contact lists, escalation tree, vendor contracts (cyber insurance, IR retainer).
- Restore-from-backup drill.

---

## 7. Contacts

Maintained in `docs/contacts.md` (restricted access). Includes:
- Internal: exec team, eng leads, security on-call rotation
- External: legal counsel, cyber insurance carrier, IR retainer firm, FBI field office, relevant data protection authorities
- Vendors: Supabase support, Vercel support, Cloudflare, payment processor

Verify contacts during quarterly drill.

---

## 8. Regulatory Reference

Non-exhaustive. Legal owns authoritative list.

- GDPR Art. 33: notify supervisory authority within 72 hr of awareness if EU personal data breach.
- GDPR Art. 34: notify data subjects without undue delay if high risk.
- US state breach notification laws: timelines vary (CA, NY, MA strictest). Legal advises.
- HIPAA (if applicable): 60-day notification to HHS + individuals.
- PCI-DSS (if applicable): notify card brands within 24 hr of suspected compromise.
- SOC2: document all incidents per control CC7.3.

---

## 9. Related Docs

- [docs/OBSERVABILITY.md](./OBSERVABILITY.md) — log sources, dashboards, alert routing
- `src/lib/audit.ts` — audit logging implementation
- `src/lib/dataRetention.ts` — log retention windows relevant to forensics
- `SUPABASE_LOG_RETENTION.sql` — Supabase log retention config
