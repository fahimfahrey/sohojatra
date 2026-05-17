import Image from "next/image";
import Link from "next/link";
import { Users, MapPin, DollarSign, ArrowRight, Star, Clock } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

interface HomePageProps {
  isAuthenticated: boolean;
}

export default function HomePage({ isAuthenticated }: HomePageProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow">
        <section className="bg-gradient-to-br from-accent-300 via-accent-400 to-secondary-500 text-white py-12 sm:py-16 lg:py-20">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
              <div className="lg:w-1/2 space-y-6 text-center lg:text-left">
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight">
                  Share Your Ride,
                  <span className="block text-white/90 text-2xl sm:text-3xl mt-2">
                    Save Your Money
                  </span>
                </h1>
                <p className="text-base sm:text-lg text-white/90 max-w-2xl mx-auto lg:mx-0">
                  Connect with passengers going the same way. Split fares and travel smarter.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  {!isAuthenticated ? (
                    <>
                      <Link href="/register" className="px-6 py-3.5 bg-white text-accent-600 rounded-2xl font-semibold shadow-large inline-flex items-center justify-center gap-2">
                        Sign up free <ArrowRight className="w-4 h-4" />
                      </Link>
                      <Link href="/login" className="px-6 py-3.5 bg-white/10 text-white rounded-2xl font-semibold border border-white/20 text-center">
                        Login
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link href="/rides" className="px-6 py-3.5 bg-white text-accent-600 rounded-2xl font-semibold shadow-large inline-flex items-center justify-center gap-2">
                        Find a Ride <ArrowRight className="w-4 h-4" />
                      </Link>
                      <Link href="/create-ride" className="px-6 py-3.5 bg-white/10 text-white rounded-2xl font-semibold border border-white/20 text-center">
                        Create a Ride
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <div className="lg:w-1/2 w-full max-w-md lg:max-w-lg">
                <Image src="/banner_image.png" alt="Ride sharing" width={600} height={400} className="w-full h-auto rounded-3xl shadow-large" priority />
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-16 bg-gray-50">
          <div className="container mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">How It Works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { Icon: MapPin, title: "Enter Your Route", desc: "Pick start and destination." },
                { Icon: Users, title: "Match With Others", desc: "Find riders on your route." },
                { Icon: DollarSign, title: "Split the Cost", desc: "Share the fare fairly." },
              ].map(({ Icon, title, desc }) => (
                <div key={title} className="bg-white p-6 rounded-2xl shadow-soft card-hover text-center">
                  <div className="w-14 h-14 bg-accent-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <Icon className="h-7 w-7 text-accent-700" />
                  </div>
                  <h3 className="font-bold mb-2">{title}</h3>
                  <p className="text-gray-600 text-sm">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12 bg-white">
          <div className="container mx-auto px-4 grid md:grid-cols-2 gap-6">
            <div className="flex gap-4 p-5 rounded-2xl">
              <DollarSign className="h-8 w-8 text-accent-600 shrink-0" />
              <div>
                <h3 className="font-bold text-lg">Save Money</h3>
                <p className="text-gray-600 text-sm mt-1">Split fares and reduce daily commute costs.</p>
              </div>
            </div>
            <div className="flex gap-4 p-5 rounded-2xl">
              <Clock className="h-8 w-8 text-secondary-600 shrink-0" />
              <div>
                <h3 className="font-bold text-lg">Save Time</h3>
                <p className="text-gray-600 text-sm mt-1">Form groups faster during peak hours.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 bg-gray-50">
          <div className="container mx-auto px-4 grid md:grid-cols-3 gap-6">
            {["Aman", "Anika", "Ashik"].map((name) => (
              <div key={name} className="bg-white p-6 rounded-2xl shadow-soft">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-accent-100 flex items-center justify-center font-bold text-accent-700">{name[0]}</div>
                  <div>
                    <h4 className="font-bold">{name}</h4>
                    <div className="flex">{[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />)}</div>
                  </div>
                </div>
                <p className="text-gray-600 text-sm">Sohojatra makes commuting affordable and reliable.</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
