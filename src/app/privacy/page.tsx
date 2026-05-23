import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Sohojatra collects, uses, retains, and protects your personal data, including GDPR rights and contact details.",
};

const LAST_UPDATED = "2026-05-23";
const DATA_PROTECTION_EMAIL = "privacy@sohojatra.com";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 max-w-3xl">
          <article className="prose prose-gray max-w-none bg-white rounded-2xl shadow-sm p-6 sm:p-10">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Privacy Policy
            </h1>
            <p className="text-sm text-gray-500 mb-8">
              Last updated: {LAST_UPDATED}
            </p>

            <p>
              This Privacy Policy describes how Sohojatra (&quot;we&quot;,
              &quot;us&quot;) collects, uses, shares, and protects personal
              data when you use the Sohojatra ride-sharing platform. It applies
              to all visitors, registered users, and ride participants.
            </p>

            <h2>1. Data Controller</h2>
            <p>
              Sohojatra acts as the data controller for the personal data we
              collect. For any privacy-related requests, contact us at{" "}
              <a href={`mailto:${DATA_PROTECTION_EMAIL}`}>
                {DATA_PROTECTION_EMAIL}
              </a>
              .
            </p>

            <h2>2. Data We Collect</h2>
            <ul>
              <li>
                <strong>Account data:</strong> name, email, phone number,
                hashed password, optional avatar.
              </li>
              <li>
                <strong>Profile &amp; verification:</strong> TOTP secret (for
                2FA, encrypted at rest), session tokens.
              </li>
              <li>
                <strong>Ride data:</strong> starting point, destination,
                planned route, seats, price, status, and ride history.
              </li>
              <li>
                <strong>Location data:</strong> precise device location, only
                when you grant explicit in-app consent and trigger a location
                feature.
              </li>
              <li>
                <strong>Communications:</strong> messages between ride
                participants, support requests, notifications you receive.
              </li>
              <li>
                <strong>Technical data:</strong> IP address, user agent,
                device type, and request metadata captured for security and
                debugging.
              </li>
              <li>
                <strong>Cookies:</strong> essential session cookies plus, with
                your consent, analytics cookies (Vercel Analytics / Speed
                Insights). See section 8.
              </li>
            </ul>

            <h2>3. Legal Bases (GDPR Art. 6)</h2>
            <ul>
              <li>
                <strong>Contract:</strong> creating your account, matching you
                with rides, processing payments between users.
              </li>
              <li>
                <strong>Consent:</strong> precise location, analytics cookies,
                marketing emails. You can withdraw at any time.
              </li>
              <li>
                <strong>Legitimate interest:</strong> fraud prevention,
                platform security, abuse detection, service improvement.
              </li>
              <li>
                <strong>Legal obligation:</strong> retention for tax, anti-
                fraud, or law-enforcement requests under applicable law.
              </li>
            </ul>

            <h2>4. How We Use Your Data</h2>
            <ul>
              <li>Operate the ride-matching and route-display features.</li>
              <li>
                Authenticate you, including two-factor checks and CSRF
                protection.
              </li>
              <li>
                Send transactional notifications (ride accepted, joined,
                cancelled).
              </li>
              <li>
                Detect and prevent abuse, spam, and unauthorised access.
              </li>
              <li>
                Improve the product through aggregated, non-identifying usage
                metrics (only when you accept analytics cookies).
              </li>
            </ul>

            <h2>5. Sharing With Other Users</h2>
            <p>
              When you create or join a ride, the other participants of that
              ride see your name, profile photo, planned route, seat count,
              and contact phone number. Phone numbers are masked until the
              ride is confirmed. We never sell personal data to third
              parties.
            </p>

            <h2>6. Processors &amp; Sub-processors</h2>
            <ul>
              <li>
                <strong>Supabase</strong> &mdash; database, auth, storage.
                Hosted in the EU.
              </li>
              <li>
                <strong>Vercel</strong> &mdash; hosting, edge runtime,
                analytics (gated by your cookie choice).
              </li>
              <li>
                <strong>Upstash Redis</strong> &mdash; rate limiting and
                idempotency keys.
              </li>
              <li>
                <strong>Ably</strong> &mdash; realtime notifications.
              </li>
              <li>
                <strong>Sentry</strong> &mdash; error monitoring; payloads are
                scrubbed of PII before transmission (see{" "}
                <code>src/lib/observability/redact.ts</code>).
              </li>
              <li>
                <strong>OpenStreetMap / Nominatim</strong> &mdash; reverse
                geocoding requests sent only when you interact with the map.
              </li>
            </ul>

            <h2>7. Retention</h2>
            <p>
              Account data is retained for the lifetime of your account. Ride
              records are kept for 18 months after completion for dispute
              resolution and then anonymised. Audit and security logs are
              retained for 12 months. See{" "}
              <code>DATA_RETENTION_POLICY.md</code> and{" "}
              <code>SUPABASE_LOG_RETENTION.sql</code> in the repository for
              the implementation.
            </p>

            <h2>8. Cookies</h2>
            <p>
              Essential cookies are required for authentication and CSRF
              protection and cannot be disabled. Analytics cookies are loaded
              only after you click <em>Accept all</em> in the consent banner.
              Rejecting cookies stores a single &quot;denied&quot; flag in
              <code>localStorage</code> so we do not re-prompt for one year.
            </p>

            <h2>9. Location Data</h2>
            <p>
              We never read your device location without an explicit click on{" "}
              <em>Allow location</em> in our in-app consent prompt. The
              browser may also ask for its own permission. You may revoke
              consent at any time via your browser&apos;s site settings or by
              clearing site data; we will re-prompt the next time a feature
              needs it. Approximate map centring uses Dhaka by default when
              consent is not granted.
            </p>

            <h2>10. Your Rights</h2>
            <p>
              Under GDPR and equivalent regimes (including the Bangladesh
              Personal Data Protection draft framework) you have the right
              to:
            </p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>
                Request erasure (&quot;right to be forgotten&quot;) where the
                data is no longer needed.
              </li>
              <li>Object to processing based on legitimate interest.</li>
              <li>Withdraw consent for location and analytics at any time.</li>
              <li>
                Receive your data in a portable, machine-readable format.
              </li>
              <li>
                Lodge a complaint with your local supervisory authority.
              </li>
            </ul>
            <p>
              To exercise any of these rights, email{" "}
              <a href={`mailto:${DATA_PROTECTION_EMAIL}`}>
                {DATA_PROTECTION_EMAIL}
              </a>
              . We respond within 30 days.
            </p>

            <h2>11. Security</h2>
            <p>
              We encrypt phone numbers at rest, enforce row-level security on
              all tables, scrub logs of PII before they leave the runtime,
              and apply strict rate limits to authentication endpoints. See{" "}
              <code>SECURITY.md</code> for the full posture.
            </p>

            <h2>12. International Transfers</h2>
            <p>
              Where data is transferred outside the EEA (for example to
              Vercel&apos;s edge or to Sentry), we rely on Standard
              Contractual Clauses and supplementary safeguards.
            </p>

            <h2>13. Children</h2>
            <p>
              Sohojatra is not directed at users under 16. If you believe a
              minor has registered, contact us and we will delete the
              account.
            </p>

            <h2>14. Changes</h2>
            <p>
              We update this policy when our practices change. Material
              changes are announced in-app and by email. The current version
              is identified by the date at the top of this page.
            </p>

            <h2>15. Contact</h2>
            <p>
              Data protection requests:{" "}
              <a href={`mailto:${DATA_PROTECTION_EMAIL}`}>
                {DATA_PROTECTION_EMAIL}
              </a>
              .
              <br />
              See also our{" "}
              <Link href="/terms" className="underline">
                Terms of Service
              </Link>
              .
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
