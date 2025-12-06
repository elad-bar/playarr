/**
 * Get color for a user role
 * @param {string} role - User role ('admin', 'user')
 * @returns {string} Color hex code
 */
export const getUserRoleColor = (role) => {
  const colorMap = {
    admin: '#1976d2',  // Primary blue (MUI primary.main)
    user: '#757575',   // Grey (MUI grey[500])
  };

  const normalizedRole = role?.toLowerCase();
  return colorMap[normalizedRole] || '#757575'; // Default grey
};

