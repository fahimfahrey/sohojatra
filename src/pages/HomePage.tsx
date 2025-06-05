import React from "react";
import { Link } from "react-router-dom";
import { Users, Clock, MapPin, DollarSign, ArrowRight, Star } from "lucide-react";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import { useAuth } from "../contexts/AuthContext";
import BannerImage from "/banner_image.png";

const HomePage: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow">
        {/* Hero Section - Enhanced responsive design */}
        <section className="bg-gradient-to-br from-accent-300 via-accent-400 to-secondary-500 text-white py-12 sm:py-16 lg:py-24 min-h-screen flex items-center">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-12">
              <div className="lg:w-1/2 space-y-6 lg:space-y-8 text-center lg:text-left">
                <div className="space-y-4">
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight">
                    Share Your Ride,
                    <span className="block text-white/90 text-2xl sm:text-3xl lg:text-4xl xl:text-5xl">
                      Save Your Money
                    </span>
                  </h1>
                  <p className="text-lg sm:text-xl lg:text-2xl text-white/90 font-light leading-relaxed max-w-2xl mx-auto lg:mx-0">
                    Connect with other passengers going the same way. Split fares,
                    reduce traffic, and make new friends.
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  {!isAuthenticated ? (
                    <>
                      <Link
                        to="/register"
                        className="group px-6 sm:px-8 py-3 sm:py-4 bg-white text-accent-600 hover:bg-gray-50 rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105 shadow-large flex items-center justify-center gap-2"
                      >
                        Sign up for free
                        <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
                      </Link>
                      <Link
                        to="/login"
                        className="px-6 sm:px-8 py-3 sm:py-4 bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 rounded-2xl font-semibold transition-all duration-300 border border-white/20 flex items-center justify-center"
                      >
                        Login
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link
                        to="/rides"
                        className="group px-6 sm:px-8 py-3 sm:py-4 bg-white text-accent-600 hover:bg-gray-50 rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105 shadow-large flex items-center justify-center gap-2"
                      >
                        Find a Ride
                        <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
                      </Link>
                      <Link
                        to="/create-ride"
                        className="px-6 sm:px-8 py-3 sm:py-4 bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 rounded-2xl font-semibold transition-all duration-300 border border-white/20 flex items-center justify-center"
                      >
                        Create a Ride
                      </Link>
                    </>
                  )}
                </div>

                {/* Stats - Enhanced responsive grid */}
                <div className="grid grid-cols-3 gap-4 sm:gap-6 lg:gap-8 pt-6 lg:pt-8 max-w-md mx-auto lg:max-w-none">
                  <div className="text-center">
                    <div className="text-xl sm:text-2xl lg:text-3xl font-bold">10K+</div>
                    <div className="text-white/80 text-xs sm:text-sm">Happy Users</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl sm:text-2xl lg:text-3xl font-bold">50K+</div>
                    <div className="text-white/80 text-xs sm:text-sm">Rides Shared</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl sm:text-2xl lg:text-3xl font-bold">2M+</div>
                    <div className="text-white/80 text-xs sm:text-sm">Money Saved</div>
                  </div>
                </div>
              </div>
              
              <div className="lg:w-1/2 flex justify-center mt-8 lg:mt-0">
                <div className="relative max-w-sm sm:max-w-md lg:max-w-full">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent rounded-3xl transform rotate-6"></div>
                  <img
                    src={BannerImage}
                    alt="Ride ride sharing"
                    className="relative w-full h-auto rounded-3xl shadow-large transform -rotate-2 hover:rotate-0 transition-transform duration-500"
                    style={{ maxHeight: "400px", objectFit: "cover" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works - Enhanced responsive cards */}
        <section className="py-12 sm:py-16 lg:py-24 bg-gray-50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 lg:mb-6">
                How It Works
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Sohojatra makes it easy to find co-passengers and share rides in
                just three simple steps.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 xl:gap-12">
              <div className="group bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 transform hover:-translate-y-2 border border-gray-100">
                <div className="w-16 h-16 lg:w-20 lg:h-20 bg-gradient-to-br from-accent-200 to-accent-300 rounded-2xl flex items-center justify-center mx-auto mb-4 lg:mb-6 group-hover:scale-110 transition-transform duration-300">
                  <MapPin className="h-8 w-8 lg:h-10 lg:w-10 text-accent-700" />
                </div>
                <h3 className="text-xl lg:text-2xl font-bold mb-3 lg:mb-4 text-gray-900 text-center">
                  Enter Your Route
                </h3>
                <p className="text-gray-600 text-center leading-relaxed">
                  Specify your starting point and destination on our interactive
                  map with real-time location services.
                </p>
              </div>

              <div className="group bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 transform hover:-translate-y-2 border border-gray-100">
                <div className="w-16 h-16 lg:w-20 lg:h-20 bg-gradient-to-br from-secondary-200 to-secondary-300 rounded-2xl flex items-center justify-center mx-auto mb-4 lg:mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Users className="h-8 w-8 lg:h-10 lg:w-10 text-secondary-700" />
                </div>
                <h3 className="text-xl lg:text-2xl font-bold mb-3 lg:mb-4 text-gray-900 text-center">
                  Match With Others
                </h3>
                <p className="text-gray-600 text-center leading-relaxed">
                  Find passengers heading to the same destination or create your
                  own ride with smart matching algorithms.
                </p>
              </div>

              <div className="group bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 transform hover:-translate-y-2 border border-gray-100">
                <div className="w-16 h-16 lg:w-20 lg:h-20 bg-gradient-to-br from-green-200 to-green-300 rounded-2xl flex items-center justify-center mx-auto mb-4 lg:mb-6 group-hover:scale-110 transition-transform duration-300">
                  <DollarSign className="h-8 w-8 lg:h-10 lg:w-10 text-green-700" />
                </div>
                <h3 className="text-xl lg:text-2xl font-bold mb-3 lg:mb-4 text-gray-900 text-center">
                  Split the Cost
                </h3>
                <p className="text-gray-600 text-center leading-relaxed">
                  Meet up, hire a ride together, and share the fare among
                  all passengers with transparent pricing.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits - Enhanced responsive layout */}
        <section className="py-12 sm:py-16 lg:py-24 bg-white">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 lg:mb-6">
                Why Share a Ride?
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Sharing rides offers several benefits beyond just splitting
                the fare. Join the smart commuting revolution.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 xl:gap-12">
              {/* Benefits items with enhanced responsive design */}
              <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 p-4 sm:p-6 rounded-2xl hover:bg-gray-50 transition-colors duration-300">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-accent-200 to-accent-300 rounded-2xl flex items-center justify-center">
                    <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-accent-700" />
                  </div>
                </div>
                <div className="space-y-3 text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                    Save Money
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                    Split the fare between 2-5 passengers and save up to 80% on
                    your transportation costs. Regular commuters can save
                    thousands each month.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 p-4 sm:p-6 rounded-2xl hover:bg-gray-50 transition-colors duration-300">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-secondary-200 to-secondary-300 rounded-2xl flex items-center justify-center">
                    <Clock className="h-6 w-6 sm:h-8 sm:w-8 text-secondary-700" />
                  </div>
                </div>
                <div className="space-y-3 text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                    Save Time
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                    No more waiting for multiple rides during peak hours.
                    Form groups faster and reach your destination without
                    delays.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 p-4 sm:p-6 rounded-2xl hover:bg-gray-50 transition-colors duration-300">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-green-200 to-green-300 rounded-2xl flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-6 w-6 sm:h-8 sm:w-8 text-green-700"
                    >
                      <path d="M2 22v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1H2z"></path>
                      <path d="M14 22v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1H14z"></path>
                      <path d="M12 7V2"></path>
                      <path d="M4.2 10.2 2.5 7.5l1.7-2.7"></path>
                      <path d="m21.5 7.5-1.7-2.7 1.7-2.8"></path>
                      <path d="M10.1 7.1 12 10l1.9-2.9"></path>
                      <path d="M2 14h20"></path>
                      <path d="M5 18h14"></path>
                    </svg>
                  </div>
                </div>
                <div className="space-y-3 text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                    Eco-Friendly
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                    Reduce the number of vehicles on the road, lower emissions,
                    and contribute to a cleaner, greener environment.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 p-4 sm:p-6 rounded-2xl hover:bg-gray-50 transition-colors duration-300">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-200 to-purple-300 rounded-2xl flex items-center justify-center">
                    <Users className="h-6 w-6 sm:h-8 sm:w-8 text-purple-700" />
                  </div>
                </div>
                <div className="space-y-3 text-center sm:text-left">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900">
                    Social Connections
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                    Meet new people who commute along your route. Build
                    connections and make your daily travels more enjoyable.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials - Enhanced responsive cards */}
        <section className="py-12 sm:py-16 lg:py-24 bg-gray-50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12 lg:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 lg:mb-6">
                What Our Users Say
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Thousands of commuters are already saving money and time with
                Sohojatra. Here's what they have to say.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              <div className="bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
                <div className="flex items-center mb-4 lg:mb-6">
                  <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-accent-200 to-accent-300 mr-3 sm:mr-4 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg sm:text-2xl font-bold text-accent-700">A</span>
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-lg sm:text-xl text-gray-900">Aman</h4>
                    <p className="text-sm sm:text-base text-gray-500">Student</p>
                    <div className="flex mt-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 sm:w-4 sm:h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                  "I save almost 2000 Taka every month by sharing rides to
                  college. The app is super easy to use and I've made some good
                  friends too!"
                </p>
              </div>

              <div className="bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
                <div className="flex items-center mb-4 lg:mb-6">
                  <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-secondary-200 to-secondary-300 mr-3 sm:mr-4 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg sm:text-2xl font-bold text-secondary-700">A</span>
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-lg sm:text-xl text-gray-900">Anika</h4>
                    <p className="text-sm sm:text-base text-gray-500">Office Worker</p>
                    <div className="flex mt-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 sm:w-4 sm:h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                  "As a woman, safety is my priority. This app helps me find
                  other women going to the same office complex. It's economical
                  and safe!"
                </p>
              </div>

              <div className="bg-white p-6 lg:p-8 rounded-3xl shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
                <div className="flex items-center mb-4 lg:mb-6">
                  <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-green-200 to-green-300 mr-3 sm:mr-4 flex items-center justify-center flex-shrink-0">
                    <span className="text-lg sm:text-2xl font-bold text-green-700">A</span>
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-lg sm:text-xl text-gray-900">Ashik</h4>
                    <p className="text-sm sm:text-base text-gray-500">IT Professional</p>
                    <div className="flex mt-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 sm:w-4 sm:h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-gray-600 leading-relaxed text-base sm:text-lg">
                  "The real-time updates are fantastic! I can see when someone
                  joins my ride and plan accordingly. Saves me time and money
                  every day."
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA - Enhanced responsive design */}
        <section className="py-12 sm:py-16 lg:py-24 bg-gradient-to-r from-accent-300 to-secondary-400 text-white relative overflow-hidden">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute inset-0" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}></div>
          </div>
          
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
            <div className="max-w-4xl mx-auto space-y-6 lg:space-y-8">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight">
                Ready to Save on Your Commute?
              </h2>
              <p className="text-lg sm:text-xl lg:text-2xl text-white/90 font-light leading-relaxed">
                Join thousands of users who are already sharing rides and
                saving money. Start your journey today.
              </p>
              <div className="flex flex-col sm:flex-row justify-center gap-4 lg:gap-6 pt-6 lg:pt-8">
                {!isAuthenticated ? (
                  <>
                    <Link
                      onClick={() => {
                        window.scrollTo({
                          top: 0,
                          behavior: "smooth",
                        });
                      }}
                      to="/register"
                      className="group px-8 sm:px-10 py-4 sm:py-5 bg-white text-accent-600 hover:bg-gray-50 rounded-2xl font-bold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 shadow-large flex items-center justify-center gap-2 sm:gap-3"
                    >
                      Sign up now
                      <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link
                      onClick={() => {
                        window.scrollTo({
                          top: 0,
                          behavior: "smooth",
                        });
                      }}
                      to="/"
                      className="px-8 sm:px-10 py-4 sm:py-5 bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 rounded-2xl font-bold text-base sm:text-lg transition-all duration-300 border border-white/20 flex items-center justify-center"
                    >
                      Learn more
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      onClick={() => {
                        window.scrollTo({
                          top: 0,
                          behavior: "smooth",
                        });
                      }}
                      to="/rides"
                      className="group px-8 sm:px-10 py-4 sm:py-5 bg-white text-accent-600 hover:bg-gray-50 rounded-2xl font-bold text-base sm:text-lg transition-all duration-300 transform hover:scale-105 shadow-large flex items-center justify-center gap-2 sm:gap-3"
                    >
                      Find a Ride
                      <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link
                      onClick={() => {
                        window.scrollTo({
                          top: 0,
                          behavior: "smooth",
                        });
                      }}
                      to="/create-ride"
                      className="px-8 sm:px-10 py-4 sm:py-5 bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 rounded-2xl font-bold text-base sm:text-lg transition-all duration-300 border border-white/20 flex items-center justify-center"
                    >
                      Create a Ride
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default HomePage;
