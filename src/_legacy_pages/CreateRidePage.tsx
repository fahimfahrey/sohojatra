import React from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CreateRideForm from '../components/rides/CreateRideForm';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const CreateRidePage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  
  // If loading, show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center bg-gradient-to-br from-accent-50 to-secondary-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-accent-500 mx-auto"></div>
            <p className="mt-6 text-gray-600 text-lg">Loading...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }
  
  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow py-6 sm:py-8 lg:py-12 bg-gradient-to-br from-accent-50 to-secondary-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Create a New Ride</h1>
            <p className="text-base sm:text-lg lg:text-xl text-gray-600 max-w-2xl mx-auto">
              Find co-passengers for your journey and split the cost of transportation
            </p>
          </div>
          <CreateRideForm />
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default CreateRidePage;