import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  Bell,
  Menu,
  X,
  User,
  LogOut,
  CheckCircle,
  Info,
  Users,
} from "lucide-react";
import { useNotification } from "../../contexts/NotificationContext";
import NotificationDropdown from "../shared/NotificationDropdown";
import Logo from "/sohojatra.png";

const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotification();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isNotificationDrawerOpen, setIsNotificationDrawerOpen] =
    useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <>
      <header className="bg-white/95 backdrop-blur-sm shadow-soft sticky top-0 z-50 border-b border-gray-100">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 sm:h-20">
            <div className="flex items-center">
              <Link to="/" className="flex-shrink-0 flex items-center">
                <img
                  src={Logo}
                  alt="Sohojatra"
                  className="w-[100px] sm:w-[120px] md:w-[150px] h-auto"
                />
              </Link>
            </div>

            {/* Desktop navigation */}
            <div className="hidden lg:ml-6 lg:flex lg:items-center space-x-1 xl:space-x-2">
              {user ? (
                <>
                  <Link
                    to="/dashboard"
                    className="px-3 xl:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 transition-all duration-200"
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/rides"
                    className="px-3 xl:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 transition-all duration-200"
                  >
                    Find Rides
                  </Link>
                  <Link
                    to="/create-ride"
                    className="px-3 xl:px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 transition-all duration-200"
                  >
                    Create Ride
                  </Link>

                  {/* Notification button */}
                  <div className="ml-2 xl:ml-3 relative">
                    <button
                      className="p-2 xl:p-3 rounded-xl text-gray-500 hover:text-accent-600 hover:bg-accent-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500 relative transition-all duration-200"
                      onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                    >
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 block h-4 w-4 xl:h-5 xl:w-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>
                    {isNotificationOpen && (
                      <NotificationDropdown
                        onClose={() => setIsNotificationOpen(false)}
                      />
                    )}
                  </div>

                  {/* Profile section */}
                  <div className="ml-3 xl:ml-4 flex items-center space-x-2 xl:space-x-4 pl-3 xl:pl-4 border-l border-gray-200">
                    <span className="text-sm font-medium text-gray-700 hidden xl:block truncate max-w-[120px]">
                      {user.name}
                    </span>
                    <button
                      className="p-2 rounded-xl text-gray-500 hover:text-accent-600 hover:bg-accent-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500 transition-all duration-200"
                      onClick={handleLogout}
                    >
                      <LogOut className="h-5 w-5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 transition-all duration-200"
                    onClick={() => {
                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });
                    }}
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    className="px-4 py-2 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white text-sm font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-medium"
                    onClick={() => {
                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });
                    }}
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center lg:hidden">
              {user && (
                <button
                  className="mr-2 p-2 rounded-xl text-gray-500 hover:text-accent-600 hover:bg-accent-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500 relative transition-all duration-200"
                  onClick={() => setIsNotificationDrawerOpen(true)}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 block h-4 w-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              )}
              <button
                className="p-2 rounded-xl text-gray-500 hover:text-accent-600 hover:bg-accent-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-500 transition-all duration-200"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                <span className="sr-only">Open main menu</span>
                {isMenuOpen ? (
                  <X className="block h-5 w-5" />
                ) : (
                  <Menu className="block h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu - Enhanced responsive design */}
        {isMenuOpen && (
          <div className="lg:hidden bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-medium">
            <div className="pt-2 pb-4 space-y-1 px-4">
              {user ? (
                <>
                  <Link
                    to="/dashboard"
                    className="block px-4 py-3 text-base font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 rounded-xl transition-all duration-200"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/rides"
                    className="block px-4 py-3 text-base font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 rounded-xl transition-all duration-200"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Find Rides
                  </Link>
                  <Link
                    to="/create-ride"
                    className="block px-4 py-3 text-base font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 rounded-xl transition-all duration-200"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Create Ride
                  </Link>
                  
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="px-4 py-3 flex items-center bg-gray-50 rounded-xl mb-2">
                      <User className="h-5 w-5 text-gray-500 mr-3 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-700 truncate">
                        {user.name}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        handleLogout();
                        setIsMenuOpen(false);
                      }}
                      className="flex items-center w-full px-4 py-3 text-base font-medium text-gray-700 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200"
                    >
                      <LogOut className="h-5 w-5 mr-3 flex-shrink-0" />
                      Sign out
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="block px-4 py-3 text-base font-medium text-gray-700 hover:text-accent-600 hover:bg-accent-50 rounded-xl transition-all duration-200"
                    onClick={() => {
                      setIsMenuOpen(false);
                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });
                    }}
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    className="block px-4 py-3 text-base font-medium text-white bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 rounded-xl transition-all duration-200 mt-2"
                    onClick={() => {
                      setIsMenuOpen(false);
                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });
                    }}
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Mobile Notification Drawer - Moved outside header */}
      {isNotificationDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black bg-opacity-50" 
            onClick={() => setIsNotificationDrawerOpen(false)}
          />
          
          {/* Drawer - Slides up from bottom */}
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] overflow-hidden shadow-2xl animate-slide-up">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-accent-50 to-accent-100">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-900">Notifications</h3>
                <button
                  onClick={() => setIsNotificationDrawerOpen(false)}
                  className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
              <NotificationDropdown 
                onClose={() => setIsNotificationDrawerOpen(false)}
                isMobileDrawer={true}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
