import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
  useTheme,
} from '@mui/material';
import { SearchOutlined as SearchIcon, ClearOutlined as ClearIcon } from '@mui/icons-material';
import { fetchIPTVProviderCategories, getMediaTypeColors } from '../utils';

/**
 * CategoriesStep - Step 4 (add) / Step 3 (edit), Xtream only
 * @param {Object} provider - Provider object
 * @param {Object} data - Step data { enabled_categories }
 * @param {Function} onChange - Callback when data changes
 * @param {Function} onSave - Callback when data is saved
 */
function CategoriesStep({ provider, data, onChange, onSave }) {
  const theme = useTheme();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all'); // 'all', 'movies', 'tvshows'
  const [pendingChanges, setPendingChanges] = useState({}); // { [categoryKey]: enabled }

  // Load categories when step is mounted
  useEffect(() => {
    if (provider?.id) {
      loadCategories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id]);

  const loadCategories = async () => {
    if (!provider?.id) return;

    setLoading(true);
    setError(null);
    try {
      const allCategories = await fetchIPTVProviderCategories(provider.id);
      setCategories(allCategories || []);
      
      // Initialize enabled_categories from provider or data
      const enabledCategories = data?.enabled_categories || provider?.enabled_categories || { movies: [], tvshows: [] };
      const enabledKeys = new Set([
        ...(enabledCategories.movies || []),
        ...(enabledCategories.tvshows || []),
      ]);

      // Update categories with enabled status
      setCategories(prev => prev.map(cat => ({
        ...cat,
        enabled: enabledKeys.has(cat.key),
      })));
    } catch (err) {
      console.error('Error loading categories:', err);
      setError(err.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  // Filter categories by media type and search query
  const filteredCategories = useMemo(() => {
    // First, filter out categories that don't have a valid type (movies or tvshows)
    // Also filter out live categories - they should never appear
    let filtered = categories.filter(cat => {
      const type = cat.type;
      return (type === 'movies' || type === 'tvshows') && type !== 'live';
    });

    // Filter by sync_media_types from provider
    if (provider?.sync_media_types) {
      filtered = filtered.filter(cat => {
        if (cat.type === 'movies') return provider.sync_media_types.movies;
        if (cat.type === 'tvshows') return provider.sync_media_types.tvshows;
        return false; // Exclude live and any other types
      });
    }

    // Filter by media type
    if (mediaTypeFilter !== 'all') {
      filtered = filtered.filter(cat => cat.type === mediaTypeFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(cat => {
        const name = (cat.category_name || cat.name || cat.key || '').toLowerCase();
        return name.includes(query);
      });
    }

    return filtered;
  }, [categories, provider?.sync_media_types, mediaTypeFilter, searchQuery]);

  // Update parent when categories change
  const updateEnabledCategories = useCallback(() => {
    const enabledCategories = {
      movies: [],
      tvshows: [],
    };

    categories.forEach(cat => {
      const categoryKey = cat.key;
      const type = cat.type;

      if (!type || (type !== 'movies' && type !== 'tvshows')) {
        return;
      }

      // Determine if category should be enabled
      const shouldBeEnabled = pendingChanges.hasOwnProperty(categoryKey)
        ? pendingChanges[categoryKey]
        : cat.enabled;

      if (shouldBeEnabled) {
        enabledCategories[type].push(categoryKey);
      }
    });

    onChange({
      enabled_categories: enabledCategories,
    });
  }, [categories, pendingChanges, onChange]);

  // Handle toggle enabled (chip click)
  const handleToggleEnabled = (categoryKey, currentEnabled) => {
    // Update local state immediately
    setCategories(prev =>
      prev.map(cat =>
        cat.key === categoryKey
          ? { ...cat, enabled: !currentEnabled }
          : cat
      )
    );

    // Track pending change
    setPendingChanges(prev => ({
      ...prev,
      [categoryKey]: !currentEnabled,
    }));
  };

  // Get chip color based on category type
  const getChipColor = (categoryType) => {
    return getMediaTypeColors(categoryType, theme).main;
  };

  // Convert hex color to rgba with opacity
  const hexToRgba = (hex, opacity) => {
    // Handle both hex format (#RRGGBB) and rgb format
    if (hex.startsWith('#')) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    // If it's already rgb/rgba, try to extract and convert
    if (hex.startsWith('rgb')) {
      const matches = hex.match(/\d+/g);
      if (matches && matches.length >= 3) {
        return `rgba(${matches[0]}, ${matches[1]}, ${matches[2]}, ${opacity})`;
      }
    }
    // Fallback
    return hex;
  };

  // Update parent when categories change
  useEffect(() => {
    updateEnabledCategories();
  }, [updateEnabledCategories]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  if (loading && categories.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error && categories.length === 0) {
    return (
      <Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }


  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Select which categories to enable for this provider. Changes are saved automatically when you click "Save & Continue".
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Media Type Filter */}
        <ToggleButtonGroup
          value={mediaTypeFilter}
          exclusive
          onChange={(e, newValue) => newValue && setMediaTypeFilter(newValue)}
          size="small"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="movies">Movies</ToggleButton>
          <ToggleButton value="tvshows">TV Shows</ToggleButton>
        </ToggleButtonGroup>

        {/* Search Filter */}
        <TextField
          placeholder="Search categories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          size="small"
          sx={{ flexGrow: 1, maxWidth: 400 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={handleClearSearch}
                  edge="end"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {filteredCategories.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="textSecondary" sx={{ fontStyle: 'italic' }}>
            {searchQuery.trim()
              ? `No categories found matching "${searchQuery}"`
              : 'No categories available'}
          </Typography>
        </Paper>
      ) : (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            width: '100%',
            maxHeight: '600px',
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          {filteredCategories.map((category) => {
            const categoryName = category.category_name || category.name || category.key || 'Unknown Category';
            const isEnabled = category.enabled;
            const categoryType = category.type || 'unknown';
            const borderColor = getChipColor(categoryType);

            return (
              <Chip
                key={category.key}
                label={categoryName}
                onClick={() => handleToggleEnabled(category.key, category.enabled)}
                sx={{
                  border: `2px solid ${borderColor}`,
                  backgroundColor: isEnabled
                    ? hexToRgba(borderColor, 0.2) // 20% opacity of border color
                    : 'transparent',
                  color: isEnabled ? borderColor : 'text.secondary',
                  fontWeight: isEnabled ? 600 : 400,
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: isEnabled
                      ? hexToRgba(borderColor, 0.3) // 30% opacity on hover
                      : hexToRgba(borderColor, 0.1), // 10% opacity on hover when disabled
                    transform: 'scale(1.05)',
                    transition: 'all 0.2s ease',
                  },
                  transition: 'all 0.2s ease',
                }}
                variant={isEnabled ? 'filled' : 'outlined'}
              />
            );
          })}
        </Paper>
      )}
    </Box>
  );
}

export default CategoriesStep;

