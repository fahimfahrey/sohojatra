import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Rules for using Sohojatra, including account responsibilities, ride conduct, payments, liability limits, and governing law.",
};

const LAST_UPDATED = "2026-05-23";

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 max-w-3xl">
          <article className="prose prose-gray max-w-none bg-white rounded-2xl shadow-sm p-6 sm:p-10">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Terms of Service
            </h1>
            <p className="text-sm text-gray-500 mb-8">
              Last updated: {LAST_UPDATED}
            </p>

            <p>
              These Terms govern your access to and use of Sohojatra (the
              &quot;Service&quot;). By creating an account or using the
              Service, you agree to be bound by these Terms. If you do not
              agree, do not use the Service.
            </p>

            <h2>1. Definitions</h2>
            <ul>
              <li>
                <strong>Sohojatra / we / us</strong> &mdash; the operator of
                the platform.
              </li>
              <li>
                <strong>User / you</strong> &mdash; any individual with an
                account.
              </li>
              <li>
                <strong>Ride</strong> &mdash; a shared journey arranged
                through the platform between a driver/host and one or more
                passengers.
              </li>
              <li>
                <strong>Content</strong> &mdash; anything you submit
                (profile, ride details, messages).
              </li>
            </ul>

            <h2>2. Eligibility</h2>
            <p>
              You must be at least 16 years old and legally capable of
              entering into a binding contract. By registering you confirm
              you meet these requirements.
            </p>

            <h2>3. Account Responsibilities</h2>
            <ul>
              <li>Provide accurate, up-to-date information.</li>
              <li>
                Protect your credentials. You are responsible for all
                activity under your account.
              </li>
              <li>
                Enable two-factor authentication where offered.
              </li>
              <li>
                Notify us promptly of any unauthorised access.
              </li>
            </ul>

            <h2>4. Nature of the Service</h2>
            <p>
              Sohojatra is a technology platform that connects users who wish
              to share rides. We do <strong>not</strong> provide
              transportation. We are not a carrier, taxi service, or vehicle
              operator. Rides are arranged directly between users.
            </p>

            <h2>5. User Conduct</h2>
            <ul>
              <li>Do not post false ride information.</li>
              <li>Do not harass, threaten, or discriminate against users.</li>
              <li>Do not use the Service for any illegal activity.</li>
              <li>
                Do not attempt to scrape, reverse engineer, or overload our
                systems.
              </li>
              <li>
                Do not share other users&apos; personal data outside the
                ride.
              </li>
            </ul>

            <h2>6. Payments Between Users</h2>
            <p>
              Fare amounts are agreed between participating users. Sohojatra
              does not currently process payments and is not a party to any
              financial transaction between users. You are responsible for
              your own tax obligations.
            </p>

            <h2>7. Cancellations</h2>
            <p>
              Cancellations should be made with reasonable notice. Repeated
              no-shows may result in account suspension.
            </p>

            <h2>8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Sohojatra is not liable
              for:
            </p>
            <ul>
              <li>The conduct, safety, or quality of rides.</li>
              <li>Personal injury, property damage, or loss during rides.</li>
              <li>Disputes between users.</li>
              <li>Service interruptions or data loss.</li>
            </ul>
            <p>
              The Service is provided &quot;as is&quot; without warranties of
              any kind.
            </p>

            <h2>9. Indemnity</h2>
            <p>
              You agree to indemnify Sohojatra against claims arising from
              your breach of these Terms or your use of the Service.
            </p>

            <h2>10. Content Licence</h2>
            <p>
              You retain ownership of the Content you submit. You grant us a
              worldwide, royalty-free licence to host, display, and process
              that Content solely to operate the Service.
            </p>

            <h2>11. Termination</h2>
            <p>
              You may delete your account at any time. We may suspend or
              terminate access for violations of these Terms, fraud, or risk
              to other users. Surviving clauses (sections 8, 9, 12, 13)
              remain in effect after termination.
            </p>

            <h2>12. Privacy</h2>
            <p>
              Your use of the Service is also governed by our{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
              , which is incorporated into these Terms by reference.
            </p>

            <h2>13. Governing Law &amp; Disputes</h2>
            <p>
              These Terms are governed by the laws of Bangladesh, without
              regard to conflict-of-law rules. Disputes shall be brought
              before the competent courts of Dhaka, except where mandatory
              local consumer-protection law grants you a different forum.
            </p>

            <h2>14. Changes</h2>
            <p>
              We may update these Terms. Material changes will be announced
              in-app at least 14 days before they take effect. Continued use
              after the effective date constitutes acceptance.
            </p>

            <h2>15. Contact</h2>
            <p>
              For questions about these Terms email{" "}
              <a href="mailto:support@sohojatra.com">
                support@sohojatra.com
              </a>
              .
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
