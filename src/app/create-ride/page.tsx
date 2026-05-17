import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import CreateRideForm from "@/components/rides/CreateRideForm";

export const metadata: Metadata = {
  title: "Create Ride",
};

export default function CreateRidePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow container mx-auto px-4 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
          Create a Ride
        </h1>
        <CreateRideForm />
      </main>
      <Footer />
    </div>
  );
}
