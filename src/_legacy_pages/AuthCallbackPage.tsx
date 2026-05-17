import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { handleOAuthUserCreation } from '../lib/auth';
import { toast } from 'react-hot-toast';

const AuthCallbackPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the session from the URL hash/fragment
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Auth callback error:', error);
          toast.error('Authentication failed. Please try again.');
          navigate('/login');
          return;
        }

        if (data.session) {
          console.log('User authenticated successfully:', data.session.user.email);
          
          // Handle user creation in database
          await handleOAuthUserCreation(data.session.user);
          
          toast.success('Successfully signed in!');
          
          // Redirect to dashboard
          navigate('/dashboard', { replace: true });
        } else {
          console.log('No session found, redirecting to login');
          navigate('/login');
        }
      } catch (error) {
        console.error('Error handling auth callback:', error);
        toast.error('Authentication failed. Please try again.');
        navigate('/login');
      } finally {
        setIsLoading(false);
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-500 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Completing sign in...
        </h2>
        <p className="text-gray-600">
          Please wait while we authenticate your account.
        </p>
      </div>
    </div>
  );
};

export default AuthCallbackPage;
