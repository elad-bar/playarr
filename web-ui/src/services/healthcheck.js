import axiosInstance from '../config/axios';
import { API_ENDPOINTS } from '../config/api';

export const checkSystemHealth = async () => {
    try {
        const response = await axiosInstance.get(API_ENDPOINTS.healthcheck);
        return response.data;
    } catch (error) {
        console.error('Health check API error:', error);
        throw error;
    }
};
