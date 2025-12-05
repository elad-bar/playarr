import axiosInstance from '../../../config/axios';
import { API_ENDPOINTS } from '../../../config/api';

// Slugify function to convert text to URL-friendly format
export const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')     // Replace spaces with -
    .replace(/[^\w-]+/g, '')  // Remove all non-word chars
    .replace(/-{2,}/g, '-')   // Replace multiple - with single -
    .replace(/^-+/, '')       // Trim - from start of text
    .replace(/-+$/, '');      // Trim - from end of text
};

// API functions
export const fetchIPTVProviders = async () => {
  try {
    const response = await axiosInstance.get(API_ENDPOINTS.providers);
    const providers = Array.isArray(response.data) ? response.data : response.data.providers || [];
    return providers.sort((a, b) => a.priority - b.priority);
  } catch (error) {
    throw error;
  }
};

export const saveIPTVProvider = async (provider, isNew = false) => {
  // If it's a new provider, always use POST (even if id is provided)
  // If it's an existing provider, use PUT with the provider id
  if (isNew || !provider.id) {
    const response = await axiosInstance.post(API_ENDPOINTS.providers, provider);
    return response.data;
  } else {
    const response = await axiosInstance.put(`${API_ENDPOINTS.providers}/${provider.id}`, provider);
    return response.data;
  }
};

export const deleteIPTVProvider = async (providerId) => {
  await axiosInstance.delete(`${API_ENDPOINTS.providers}/${providerId}`);
};

export const fetchIPTVProviderCategories = async (providerId) => {
  const response = await axiosInstance.get(API_ENDPOINTS.providerCategories(providerId));
  return response.data;
};

export const validateIPTVProviderCredentials = async (api_url, username, password, type) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.providerValidate, {
      api_url,
      username,
      password,
      type
    });
    return response.data;
  } catch (error) {
    // Handle network errors or unexpected errors
    return {
      success: false,
      valid: false,
      error: error.response?.data?.error || error.message || 'Failed to validate credentials'
    };
  }
};

export const checkIPTVProviderStatus = async (providerId) => {
  const response = await axiosInstance.get(API_ENDPOINTS.providerStatus(providerId));
  return response.data;
};

export const updateIPTVProviderPriorities = async (providers) => {
  const response = await axiosInstance.put(`${API_ENDPOINTS.providers}/priorities`, providers);
  return response.data;
};

export const updateIPTVProviderCategory = async (providerId, categoryId, categoryData) => {
  const response = await axiosInstance.put(
    `${API_ENDPOINTS.providerCategories(providerId)}/${categoryId}`,
    categoryData
  );
  return response.data;
};

export const fetchIPTVProviderIgnoredTitles = async (providerId) => {
  const response = await axiosInstance.get(API_ENDPOINTS.providerIgnoredTitles(providerId));
  return response.data;
};

export const fetchTMDBProviders = async () => {
  try {
    const response = await axiosInstance.get(`${API_ENDPOINTS.providers}/tmdb`);
    const providers = response.data?.providers || [];
    return providers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (error) {
    console.error('Error in fetchTMDBProviders:', error);
    return [];
  }
};
