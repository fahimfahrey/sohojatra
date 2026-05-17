"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import TermsModal from "@/components/modals/TermsModal";
import PrivacyModal from "@/components/modals/PrivacyModal";

export default function Footer() {
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  return (
    <footer className="bg-gradient-to-r from-accent-600 to-secondary-600 text-white">
      <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          <div className="sm:col-span-2">
            <Image
              src="/sohojatra.png"
              alt="Sohojatra"
              width={180}
              height={56}
              className="w-[140px] sm:w-[160px] mb-4 h-auto"
            />
            <p className="text-white/80 text-sm sm:text-base leading-relaxed max-w-md">
              Connecting passengers to share rides and reduce transportation
              costs across Bangladesh.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm sm:text-base">
              <li>
                <Link href="/" className="text-white/80 hover:text-white">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/rides" className="text-white/80 hover:text-white">
                  Find Rides
                </Link>
              </li>
              <li>
                <Link
                  href="/create-ride"
                  className="text-white/80 hover:text-white"
                >
                  Create Ride
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold mb-4">Support & Legal</h3>
            <ul className="space-y-2 text-sm sm:text-base mb-6">
              <li>
                <a
                  href="https://www.linkedin.com/in/muhammad-faahem/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/80 hover:text-white"
                >
                  Contact Us
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setIsTermsModalOpen(true)}
                  className="text-white/80 hover:text-white text-left"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setIsPrivacyModalOpen(true)}
                  className="text-white/80 hover:text-white text-left"
                >
                  Privacy Policy
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/20 mt-8 pt-6 text-center text-white/70 text-sm">
          &copy; {new Date().getFullYear()} Sohojatra. All rights reserved.
        </div>
      </div>

      <TermsModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
      />
      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />
    </footer>
  );
}
