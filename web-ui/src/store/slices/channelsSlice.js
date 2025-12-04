import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

// LocalStorage key for persisting filters and pagination
const STORAGE_KEY = 'playarr_channels_preferences';

// Load preferences from localStorage
const loadPreferences = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading preferences from localStorage:', error);
  }
  return null;
};

// Save preferences to localStorage
const savePreferences = (filters, pagination) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      filters,
      pagination: {
        per_page: pagination.per_page // Only save per_page, not page number
      }
    }));
  } catch (error) {
    console.error('Error saving preferences to localStorage:', error);
  }
};

const defaultFilters = {
  watchlistFilter: 'all', // 'all', 'checked', 'unchecked'
  providerId: '',
  searchQuery: '',
  categories: [], // Array of selected category names
  sortBy: 'name',
  sortOrder: 'asc'
};

const defaultPagination = {
  page: 1,
  per_page: 50,
  total: 0,
  total_pages: 0
};

// Load initial state from localStorage
const preferences = loadPreferences();
const initialState = {
  channels: [],
  programs: {}, // channelKey -> programs array
  loading: false,
  error: null,
  categories: [], // Store available categories
  categoriesLoading: false,
  pagination: {
    ...defaultPagination,
    ...(preferences?.pagination || {})
  },
  filters: {
    ...defaultFilters,
    ...(preferences?.filters || {})
  }
};

// Async thunks for channels operations
export const fetchChannels = createAsyncThunk(
  'channels/fetchChannels',
  async (_, { getState }) => {
    const { filters, pagination } = getState().channels;
    const response = await axiosInstance.get(API_ENDPOINTS.channels({
      ...filters,
      page: pagination.page,
      per_page: pagination.per_page
    }));
    return response.data;
  }
);

/**
 * Fetch programs for a specific channel
 */
export const fetchChannelPrograms = createAsyncThunk(
  'channels/fetchChannelPrograms',
  async (channelKey, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get(`/livetv/channels/${encodeURIComponent(channelKey)}/programs`);
      return { channelKey, programs: response.data };
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || 'Failed to fetch programs');
    }
  }
);

/**
 * Add channel to watchlist
 */
export const addChannelToWatchlist = createAsyncThunk(
  'channels/addChannelToWatchlist',
  async (channelKey) => {
    const response = await axiosInstance.post(API_ENDPOINTS.channelWatchlist(), {
      channelKey
    });
    // Return both the response and the channelKey/watchlist status for state update
    return {
      ...response.data,
      channelKey,
      watchlist: true
    };
  }
);

/**
 * Remove channel from watchlist
 */
export const removeChannelFromWatchlist = createAsyncThunk(
  'channels/removeChannelFromWatchlist',
  async (channelKey) => {
    const response = await axiosInstance.delete(API_ENDPOINTS.channelWatchlistRemove(channelKey));
    // Return both the response and the channelKey/watchlist status for state update
    return {
      ...response.data,
      channelKey,
      watchlist: false
    };
  }
);

/**
 * Fetch all unique categories from channels
 */
export const fetchCategories = createAsyncThunk(
  'channels/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosInstance.get('/livetv/categories');
      return response.data.categories || [];
    } catch (error) {
      return rejectWithValue(error.response?.data?.error || 'Failed to fetch categories');
    }
  }
);

const channelsSlice = createSlice({
  name: 'channels',
  initialState,
  reducers: {
    clearChannels: (state) => {
      state.channels = [];
      state.programs = {};
      state.error = null;
    },
    updateFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
      // Reset pagination when filters change
      state.pagination.page = 1;
      state.channels = [];
      // Save to localStorage
      savePreferences(state.filters, state.pagination);
    },
    clearFilters: (state) => {
      state.filters = defaultFilters;
      state.pagination.page = 1;
      state.channels = [];
      // Save to localStorage
      savePreferences(state.filters, state.pagination);
    },
    incrementPage: (state) => {
      if (state.pagination.page < state.pagination.total_pages) {
        state.pagination.page += 1;
      }
    },
    updatePagination: (state, action) => {
      state.pagination = { ...state.pagination, ...action.payload };
      // Save pagination preferences to localStorage
      savePreferences(state.filters, state.pagination);
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
        // Append new items to existing ones for infinite scroll
        state.channels = state.pagination.page === 1
          ? action.payload.items
          : [...state.channels, ...action.payload.items];
        // Update pagination info
        state.pagination = action.payload.pagination;
        state.error = null;
      })
      .addCase(fetchChannels.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Fetch channel programs
      .addCase(fetchChannelPrograms.fulfilled, (state, action) => {
        const { channelKey, programs } = action.payload;
        state.programs[channelKey] = programs;
      })
      // Add to Watchlist
      .addCase(addChannelToWatchlist.fulfilled, (state, action) => {
        if (!action.payload || !action.payload.channelKey) return;

        // Update the channel in the list
        const channel = state.channels.find(ch => ch.channel_key === action.payload.channelKey);
        if (channel) {
          channel.watchlist = action.payload.watchlist;
        }
      })
      // Remove from Watchlist
      .addCase(removeChannelFromWatchlist.fulfilled, (state, action) => {
        if (!action.payload || !action.payload.channelKey) return;

        // Update the channel in the list
        const channel = state.channels.find(ch => ch.channel_key === action.payload.channelKey);
        if (channel) {
          channel.watchlist = action.payload.watchlist;
        }
      })
      // Handle errors
      .addCase(addChannelToWatchlist.rejected, (state, action) => {
        state.error = action.error.message;
      })
      .addCase(removeChannelFromWatchlist.rejected, (state, action) => {
        state.error = action.error.message;
      })
      // Fetch categories
      .addCase(fetchCategories.pending, (state) => {
        state.categoriesLoading = true;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categoriesLoading = false;
        state.categories = action.payload;
      })
      .addCase(fetchCategories.rejected, (state, action) => {
        state.categoriesLoading = false;
        state.error = action.error.message;
      });
  }
});

export const {
  clearChannels,
  updateFilters,
  clearFilters,
  incrementPage,
  updatePagination
} = channelsSlice.actions;

export default channelsSlice.reducer;
