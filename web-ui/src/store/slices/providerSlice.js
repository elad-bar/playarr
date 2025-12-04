import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

export const fetchProviders = createAsyncThunk(
  'providers/fetchProviders',
  async () => {
    const response = await axiosInstance.get(API_ENDPOINTS.providers);
    return response.data;
  }
);

export const saveProvider = createAsyncThunk(
  'providers/saveProvider',
  async (providerData) => {
    const response = await axiosInstance.post(API_ENDPOINTS.providers, providerData);
    return response.data;
  }
);

export const deleteProvider = createAsyncThunk(
  'providers/deleteProvider',
  async (providerId) => {
    await axiosInstance.delete(`${API_ENDPOINTS.providers}/${providerId}`);
    return providerId;
  }
);

const initialState = {
  providers: [],
  selectedProvider: null,
  loading: false,
  error: null
};

const providerSlice = createSlice({
  name: 'providers',
  initialState,
  reducers: {
    setSelectedProvider: (state, action) => {
      state.selectedProvider = action.payload;
    },
    clearSelectedProvider: (state) => {
      state.selectedProvider = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch Providers
      .addCase(fetchProviders.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProviders.fulfilled, (state, action) => {
        state.loading = false;
        // API returns { providers: [...] }, extract the array
        state.providers = Array.isArray(action.payload) 
          ? action.payload 
          : (action.payload?.providers || []);
      })
      .addCase(fetchProviders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Save Provider
      .addCase(saveProvider.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveProvider.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.providers.findIndex(p => p.id === action.payload.id);
        if (index !== -1) {
          state.providers[index] = action.payload;
        } else {
          state.providers.push(action.payload);
        }
        state.selectedProvider = action.payload;
      })
      .addCase(saveProvider.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Delete Provider
      .addCase(deleteProvider.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteProvider.fulfilled, (state, action) => {
        state.loading = false;
        state.providers = state.providers.filter(p => p.id !== action.payload);
        if (state.selectedProvider?.id === action.payload) {
          state.selectedProvider = null;
        }
      })
      .addCase(deleteProvider.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  }
});

export const { setSelectedProvider, clearSelectedProvider } = providerSlice.actions;
export default providerSlice.reducer;
