import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';

/**
 * Fetch channels from API
 */
export const fetchChannels = createAsyncThunk(
  'channels/fetchChannels',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get('/livetv/channels');
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || 'Failed to fetch channels');
    }
  }
);

/**
 * Fetch programs for a specific channel
 */
export const fetchChannelPrograms = createAsyncThunk(
  'channels/fetchChannelPrograms',
  async (channelId, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(`/livetv/channels/${encodeURIComponent(channelId)}/programs`);
      return { channelId, programs: response.data };
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || 'Failed to fetch programs');
    }
  }
);

const channelsSlice = createSlice({
  name: 'channels',
  initialState: {
    channels: [],
    programs: {}, // channelId -> programs array
    loading: false,
    error: null
  },
  reducers: {
    clearChannels: (state) => {
      state.channels = [];
      state.programs = {};
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch channels
      .addCase(fetchChannels.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchChannels.fulfilled, (state, action) => {
        state.loading = false;
        state.channels = action.payload;
        state.error = null;
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Fetch channel programs
      .addCase(fetchChannelPrograms.fulfilled, (state, action) => {
        const { channelId, programs } = action.payload;
        state.programs[channelId] = programs;
      });
  }
});

export const { clearChannels } = channelsSlice.actions;
export default channelsSlice.reducer;

