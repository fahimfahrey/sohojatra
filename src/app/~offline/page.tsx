import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">You are offline</h1>
      <p className="text-gray-600 mb-6 max-w-sm">
        Check your internet connection and try again. Cached pages may still be
        available when you reconnect.
      </p>
      <Link
        href="/"
        className="px-6 py-3 bg-accent-500 text-white rounded-xl font-semibold hover:bg-accent-600"
      >
        Go to home
      </Link>
    </div>
  );
}
