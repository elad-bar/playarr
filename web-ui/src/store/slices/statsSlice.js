import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

export const fetchStats = createAsyncThunk(
  'stats/fetchStats',
  async () => {
    try {
      const response = await axiosInstance.get(API_ENDPOINTS.stats);
      return response.data;
    } catch (error) {
      throw error;
    }
  }
);

const initialState = {
  providerStats: [],
  loading: false,
  error: null
};

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {
    updateStatsFromWebSocket: (state, action) => {
      // Process and group the stats by type for each provider
      state.providerStats = action.payload.providers.map(provider => {
        const groupedStats = provider.stats.reduce((acc, stat) => {
          if (!acc[stat.type]) {
            acc[stat.type] = {
              type: stat.type,
              items: []
            };
          }
          acc[stat.type].items.push({
            name: stat.name,
            value: stat.value
          });
          return acc;
        }, {});

        return {
          name: provider.name,
          type: provider.type,
          stats: Object.values(groupedStats)
        };
      });
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.loading = false;
        // Process and group the stats by type for each provider
        state.providerStats = action.payload.providers.map(provider => {
          const groupedStats = provider.stats.reduce((acc, stat) => {
            if (!acc[stat.type]) {
              acc[stat.type] = {
                type: stat.type,
                items: []
              };
            }
            acc[stat.type].items.push({
              name: stat.name,
              value: stat.value
            });
            return acc;
          }, {});

          return {
            name: provider.name,
            type: provider.type,
            stats: Object.values(groupedStats)
          };
        });
      })
      .addCase(fetchStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  }
});

export const { updateStatsFromWebSocket } = statsSlice.actions;
export default statsSlice.reducer;
