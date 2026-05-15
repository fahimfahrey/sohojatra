import React, { useState } from "react";
import Modal from "../shared/Modal";
import { Phone } from "lucide-react";

interface PhoneNumberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (phoneNumber: string) => void;
}

const PhoneNumberModal: React.FC<PhoneNumberModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");

  // Validate phone number format
  const validatePhoneNumber = (phone: string): boolean => {
    // Remove common separators
    const cleaned = phone.replace(/[\s\-\(\)\.]/g, "");

    // Check length (10-15 digits)
    if (cleaned.length < 10 || cleaned.length > 15) {
      return false;
    }

    // Check if only digits and optional leading +
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    return phoneRegex.test(cleaned);
  };

  // Sanitize phone number
  const sanitizePhoneNumber = (phone: string): string => {
    // Remove all non-digit characters except leading +
    return phone.replace(/[^\d+]/g, "").slice(0, 20);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Trim whitespace
    const trimmedPhone = phoneNumber.trim();

    // Check if empty
    if (!trimmedPhone) {
      setError("Phone number is required");
      return;
    }

    // Validate format
    if (!validatePhoneNumber(trimmedPhone)) {
      setError("Please enter a valid phone number (10-15 digits)");
      return;
    }

    // Sanitize before submission
    const sanitized = sanitizePhoneNumber(trimmedPhone);

    setError("");
    onSubmit(sanitized);
    setPhoneNumber("");
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Contact Information">
      <form onSubmit={handleSubmit}>
        <div className="mb-4 sm:mb-6">
          <label
            htmlFor="phone"
            className="block text-sm sm:text-base font-semibold text-gray-700 mb-2 sm:mb-3"
          >
            Your Phone Number
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none">
              <Phone className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
            </div>
            <input
              type="tel"
              id="phone"
              className="block w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-2 sm:py-3 border border-gray-300 rounded-lg sm:rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-colors text-sm sm:text-base"
              placeholder="+1234567890"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              maxLength={20}
              required
            />
          </div>
          {error && (
            <p className="mt-2 text-xs sm:text-sm text-red-600">{error}</p>
          )}

          <div className="mt-2 sm:mt-3 p-3 sm:p-4 bg-blue-50 rounded-lg sm:rounded-xl border border-blue-200">
            <p className="text-xs sm:text-sm text-blue-700">
              <strong>📱 Why we need this:</strong> Your phone number will be
              shared with other passengers once they join your ride, making it
              easy to coordinate meeting points and timing.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <button
            type="button"
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg sm:rounded-xl hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm sm:text-base"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-semibold rounded-lg sm:rounded-xl transition-all duration-200 transform hover:scale-105 shadow-medium focus:outline-none focus:ring-2 focus:ring-accent-400 text-sm sm:text-base"
          >
            Create Ride
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default PhoneNumberModal;
