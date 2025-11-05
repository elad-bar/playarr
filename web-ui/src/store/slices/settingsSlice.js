import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

// Async thunks
export const fetchTMDBAPIKey = createAsyncThunk(
  'settings/fetchTMDBAPIKey',
  async () => {
    const response = await axiosInstance.get(API_ENDPOINTS.tmdb.apiKey);
    return response.data;
  }
);

export const saveTMDBAPIKey = createAsyncThunk(
  'settings/saveTMDBAPIKey',
  async (apiKey) => {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.apiKey, { api_key: apiKey });
    return response.data;
  }
);

export const verifyTMDBAPIKey = createAsyncThunk(
  'settings/verifyTMDBAPIKey',
  async (apiKey) => {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.verify, { api_key: apiKey });
    return response.data;
  }
);

export const fetchTMDBLists = createAsyncThunk(
  'settings/fetchTMDBLists',
  async (apiKey) => {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.lists, { api_key: apiKey });
    return response.data;
  }
);

export const fetchTMDBListItems = createAsyncThunk(
  'settings/fetchTMDBListItems',
  async ({ apiKey, listId }) => {
    const response = await axiosInstance.post(API_ENDPOINTS.tmdb.listItems(listId), { api_key: apiKey });
    return response.data;
  }
);

const initialState = {
  activeTab: 0,
  tmdb: {
    apiKey: '',
    lists: [],
    selectedList: '',
    listItems: [],
    selectedItems: [],
    loading: false,
    error: null,
    success: null,
    isVerified: false
  }
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
    },
    setSelectedList: (state, action) => {
      state.tmdb.selectedList = action.payload;
    },
    setSelectedItems: (state, action) => {
      state.tmdb.selectedItems = action.payload;
    },
    clearTMDBError: (state) => {
      state.tmdb.error = null;
    },
    clearTMDBSuccess: (state) => {
      state.tmdb.success = null;
    },
    updateListItemsWatchlistStatus: (state, action) => {
      const updatedTitles = action.payload;
      state.tmdb.listItems = state.tmdb.listItems.map(item => {
        const titleKey = `${item.media_type === 'movie' ? 'movies' : 'shows'}-${item.id}`;
        if (updatedTitles.some(t => t.key === titleKey)) {
          return { ...item, in_watchlist: true };
        }
        return item;
      });
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch TMDB API Key
      .addCase(fetchTMDBAPIKey.pending, (state) => {
        state.tmdb.loading = true;
        state.tmdb.error = null;
      })
      .addCase(fetchTMDBAPIKey.fulfilled, (state, action) => {
        state.tmdb.loading = false;
        state.tmdb.apiKey = action.payload.api_key || '';
      })
      .addCase(fetchTMDBAPIKey.rejected, (state, action) => {
        state.tmdb.loading = false;
        state.tmdb.error = 'Failed to load TMDB API key';
      })
      // Save TMDB API Key
      .addCase(saveTMDBAPIKey.pending, (state) => {
        state.tmdb.loading = true;
        state.tmdb.error = null;
      })
      .addCase(saveTMDBAPIKey.fulfilled, (state, action) => {
        state.tmdb.loading = false;
        state.tmdb.apiKey = action.payload.api_key;
        state.tmdb.success = 'TMDB API key saved successfully';
      })
      .addCase(saveTMDBAPIKey.rejected, (state) => {
        state.tmdb.loading = false;
        state.tmdb.error = 'Failed to save TMDB API key';
      })
      // Verify TMDB API Key
      .addCase(verifyTMDBAPIKey.pending, (state) => {
        state.tmdb.loading = true;
        state.tmdb.error = null;
      })
      .addCase(verifyTMDBAPIKey.fulfilled, (state) => {
        state.tmdb.loading = false;
        state.tmdb.isVerified = true;
        state.tmdb.success = 'TMDB API key verified successfully';
      })
      .addCase(verifyTMDBAPIKey.rejected, (state) => {
        state.tmdb.loading = false;
        state.tmdb.isVerified = false;
        state.tmdb.error = 'Invalid TMDB API key';
      })
      // Fetch TMDB Lists
      .addCase(fetchTMDBLists.pending, (state) => {
        state.tmdb.loading = true;
        state.tmdb.error = null;
      })
      .addCase(fetchTMDBLists.fulfilled, (state, action) => {
        state.tmdb.loading = false;
        state.tmdb.lists = action.payload.lists || [];
      })
      .addCase(fetchTMDBLists.rejected, (state) => {
        state.tmdb.loading = false;
        state.tmdb.error = 'Failed to fetch TMDB lists';
      })
      // Fetch TMDB List Items
      .addCase(fetchTMDBListItems.pending, (state) => {
        state.tmdb.loading = true;
        state.tmdb.error = null;
      })
      .addCase(fetchTMDBListItems.fulfilled, (state, action) => {
        state.tmdb.loading = false;
        state.tmdb.listItems = action.payload.items || [];
      })
      .addCase(fetchTMDBListItems.rejected, (state) => {
        state.tmdb.loading = false;
        state.tmdb.error = 'Failed to fetch TMDB list items';
      });
  }
});

export const {
  setActiveTab,
  setSelectedList,
  setSelectedItems,
  clearTMDBError,
  clearTMDBSuccess,
  updateListItemsWatchlistStatus
} = settingsSlice.actions;

export default settingsSlice.reducer;
