"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cookieConsent } from "@/lib/consent";

export default function Footer() {
  const [showCookieReset, setShowCookieReset] = useState(false);

  useEffect(() => {
    setShowCookieReset(cookieConsent.get() !== null);
  }, []);

  const resetCookieConsent = () => {
    cookieConsent.clear();
    setShowCookieReset(false);
  };

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
                <Link
                  href="/terms"
                  className="text-white/80 hover:text-white text-left"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="text-white/80 hover:text-white text-left"
                >
                  Privacy Policy
                </Link>
              </li>
              {showCookieReset && (
                <li>
                  <button
                    type="button"
                    onClick={resetCookieConsent}
                    className="text-white/80 hover:text-white text-left"
                  >
                    Cookie preferences
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/20 mt-8 pt-6 text-center text-white/70 text-sm">
          &copy; {new Date().getFullYear()} Sohojatra. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
