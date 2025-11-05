import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * RoleBasedRoute component that redirects users based on their role.
 * Admin users go to home (stats), regular users go to titles.
 */
const RoleBasedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // Will be handled by PrivateRoute
  }

  // If user is not admin, redirect to titles
  if (user && user.role !== 'admin') {
    return <Navigate to="/titles" replace />;
  }

  // Admin users see the normal home page
  return children;
};

export default RoleBasedRoute;
