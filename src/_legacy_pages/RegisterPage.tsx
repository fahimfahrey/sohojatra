import React from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import RegisterForm from '../components/auth/RegisterForm';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const RegisterPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  
  // If already authenticated, redirect to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-grow flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <RegisterForm />
      </main>
      
      <Footer />
    </div>
  );
};

export default RegisterPage;