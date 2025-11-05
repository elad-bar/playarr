// Get the API URL from environment variables, defaulting to relative /api
// This allows the React app to work with the Node.js API server on the same port
export const API_URL = process.env.REACT_APP_API_URL || '/api';

// Add other configuration constants as needed
