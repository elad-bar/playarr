import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * AdminRoute component that only allows admin users.
 * Redirects regular users to home (which will redirect them to titles).
 */
const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // Will be handled by PrivateRoute
  }

  // If user is not admin, redirect to home (which will redirect to titles for regular users)
  if (user && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default AdminRoute;
