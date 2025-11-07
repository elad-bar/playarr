import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

// LocalStorage key for persisting filters and pagination
const STORAGE_KEY = 'playarr_titles_preferences';

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
  mediaType: '',
  searchQuery: '',
  yearFilter: '',
  selectedLetter: '',
  watchlistFilter: 'all',
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
  titles: [],
  selectedTitle: null,
  watchlistStats: null,
  loading: false,
  error: null,
  pagination: {
    ...defaultPagination,
    ...(preferences?.pagination || {})
  },
  filters: {
    ...defaultFilters,
    ...(preferences?.filters || {})
  }
};

// Async thunks for titles operations
export const fetchTitles = createAsyncThunk(
  'titles/fetchTitles',
  async (_, { getState }) => {
    const { filters, pagination } = getState().titles;
    const response = await axiosInstance.get(API_ENDPOINTS.titles(filters.mediaType, {
      ...filters,
      page: pagination.page,
      per_page: pagination.per_page
    }));
    return response.data;
  }
);

export const fetchTitleDetails = createAsyncThunk(
  'titles/fetchTitleDetails',
  async (titleKey) => {
    const response = await axiosInstance.get(API_ENDPOINTS.titleDetails(titleKey));
    return response.data;
  }
);

// Watchlist operations
export const fetchWatchlistStats = createAsyncThunk(
  'titles/fetchWatchlistStats',
  async () => {
    const response = await axiosInstance.get(API_ENDPOINTS.watchlistStats);
    return response.data;
  }
);

export const addToWatchlist = createAsyncThunk(
  'titles/addToWatchlist',
  async (titleKey) => {
    const response = await axiosInstance.put(API_ENDPOINTS.watchlist(titleKey), {
      watchlist: true
    });
    // Return both the response and the titleKey/watchlist status for state update
    return {
      ...response.data,
      titleKey,
      watchlist: true
    };
  }
);

export const removeFromWatchlist = createAsyncThunk(
  'titles/removeFromWatchlist',
  async (titleKey) => {
    const response = await axiosInstance.put(API_ENDPOINTS.watchlist(titleKey), {
      watchlist: false
    });
    // Return both the response and the titleKey/watchlist status for state update
    return {
      ...response.data,
      titleKey,
      watchlist: false
    };
  }
);

export const updateWatchlistBulk = createAsyncThunk(
  'titles/updateWatchlistBulk',
  async (data) => {
    await axiosInstance.put(API_ENDPOINTS.watchlistBulk, data);
    // Return the titles array with titleKey and watchlist status for state update
    // data.titles should be an array of { key, watchlist }
    return data.titles || [];
  }
);

const titlesSlice = createSlice({
  name: 'titles',
  initialState,
  reducers: {
    setSelectedTitle: (state, action) => {
      state.selectedTitle = action.payload;
    },
    clearSelectedTitle: (state) => {
      state.selectedTitle = null;
    },
    updateFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
      // Reset pagination when filters change
      state.pagination.page = 1;
      state.titles = [];
      // Save to localStorage
      savePreferences(state.filters, state.pagination);
    },
    clearFilters: (state) => {
      state.filters = defaultFilters;
      state.pagination.page = 1;
      state.titles = [];
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
      // Fetch Titles
      .addCase(fetchTitles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTitles.fulfilled, (state, action) => {
        state.loading = false;
        // Append new items to existing ones for infinite scroll
        state.titles = state.pagination.page === 1
          ? action.payload.items
          : [...state.titles, ...action.payload.items];
        // Update pagination info
        state.pagination = action.payload.pagination;
      })
      .addCase(fetchTitles.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Fetch Title Details
      .addCase(fetchTitleDetails.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTitleDetails.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedTitle = action.payload;
      })
      .addCase(fetchTitleDetails.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Fetch Watchlist Stats
      .addCase(fetchWatchlistStats.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWatchlistStats.fulfilled, (state, action) => {
        state.loading = false;
        state.watchlistStats = action.payload;
      })
      .addCase(fetchWatchlistStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      })
      // Add to Watchlist
      .addCase(addToWatchlist.fulfilled, (state, action) => {
        if (!action.payload || !action.payload.titleKey) return;

        // Update the title in the list
        const title = state.titles.find(t => t.key === action.payload.titleKey);
        if (title) {
          title.watchlist = action.payload.watchlist;
        }

        // Update the selected title if it's the same one
        if (state.selectedTitle?.key === action.payload.titleKey) {
          state.selectedTitle.watchlist = action.payload.watchlist;
        }
      })
      // Remove from Watchlist
      .addCase(removeFromWatchlist.fulfilled, (state, action) => {
        if (!action.payload || !action.payload.titleKey) return;

        // Update the title in the list
        const title = state.titles.find(t => t.key === action.payload.titleKey);
        if (title) {
          title.watchlist = action.payload.watchlist;
        }

        // Update the selected title if it's the same one
        if (state.selectedTitle?.key === action.payload.titleKey) {
          state.selectedTitle.watchlist = action.payload.watchlist;
        }
      })
      // Update Watchlist Bulk
      .addCase(updateWatchlistBulk.fulfilled, (state, action) => {
        if (!action.payload || !Array.isArray(action.payload)) return;

        // Update watchlist status for all affected titles
        action.payload.forEach(update => {
          if (!update || !update.titleKey) return;

          const title = state.titles.find(t => t.key === update.titleKey);
          if (title) {
            title.watchlist = update.watchlist;
          }
          if (state.selectedTitle?.key === update.titleKey) {
            state.selectedTitle.watchlist = update.watchlist;
          }
        });
      })
      // Handle errors
      .addCase(addToWatchlist.rejected, (state, action) => {
        state.error = action.error.message;
      })
      .addCase(removeFromWatchlist.rejected, (state, action) => {
        state.error = action.error.message;
      })
      .addCase(updateWatchlistBulk.rejected, (state, action) => {
        state.error = action.error.message;
      });
  }
});

export const {
  setSelectedTitle,
  clearSelectedTitle,
  updateFilters,
  clearFilters,
  incrementPage,
  updatePagination
} = titlesSlice.actions;

export default titlesSlice.reducer;
