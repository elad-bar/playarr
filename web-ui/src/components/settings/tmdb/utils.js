import axiosInstance from '../../../config/axios';
import { API_ENDPOINTS } from '../../../config/api';

// API functions for TMDB API key
export const fetchTMDBAPIKey = async () => {
  try {
    const response = await axiosInstance.get(API_ENDPOINTS.tmdb.apiKey);
    return response.data;
  } catch (error) {
    console.error('Error in fetchTMDBAPIKey:', error);
    throw error;
  }
};

export const setTMDBAPIKey = async (apiKey) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.apiKey, { api_key: apiKey });
    return response.data;
  } catch (error) {
    console.error('Error in setTMDBAPIKey:', error);
    throw error;
  }
};

export const verifyTMDBAPIKey = async (apiKey) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.verify, { api_key: apiKey });
    return response.data;
  } catch (error) {
    console.error('Error in verifyTMDBAPIKey:', error);
    throw error;
  }
};

// API functions for TMDB lists
export const fetchTMDBLists = async (apiKey) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.lists, { api_key: apiKey });
    return response.data;
  } catch (error) {
    console.error('Error in fetchTMDBLists:', error);
    throw error;
  }
};

export const fetchTMDBListItems = async (apiKey, listId) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.listItems(listId), { api_key: apiKey });
    return response.data;
  } catch (error) {
    console.error('Error in fetchTMDBListItems:', error);
    throw error;
  }
};

export const importTMDBList = async (apiKey, listId) => {
  try {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.importList, {
      api_key: apiKey,
      list_id: listId
    });
    return response.data;
  } catch (error) {
    console.error('Error in importTMDBList:', error);
    throw error;
  }
};
