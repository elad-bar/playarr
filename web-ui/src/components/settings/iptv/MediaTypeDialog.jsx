import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
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
import CloseIcon from '@mui/icons-material/Close';
import { SearchOutlined as SearchIcon, ClearOutlined as ClearIcon } from '@mui/icons-material';
import { fetchIPTVProviderCategories, getMediaTypeColors, getMediaTypeLabel } from './utils';
import axiosInstance from '../../../config/axios';
import { API_ENDPOINTS } from '../../../config/api';

/**
 * MediaTypeDialog - Dialog for managing media type sync states and categories
 * @param {boolean} open - Whether dialog is open
 * @param {Object} provider - Provider object
 * @param {Function} onClose - Callback when dialog is closed
 * @param {Function} onSave - Callback when changes are saved
 */
function MediaTypeDialog({ open, provider, onClose, onSave }) {
  const theme = useTheme();
  const [syncMediaTypes, setSyncMediaTypes] = useState(
    provider?.sync_media_types || {
      movies: false,
      tvshows: false,
      live: false,
    }
  );
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [pendingCategoryChanges, setPendingCategoryChanges] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Load categories once when dialog opens
  const loadCategories = useCallback(async () => {
    if (!provider?.id) return;

    setLoading(true);
    setError(null);
    try {
      const allCategories = await fetchIPTVProviderCategories(provider.id);
      
      // Update enabledCategories from provider if not already set
      const providerEnabledCategories = provider.enabled_categories || { movies: [], tvshows: [] };

      // Initialize enabled status from provider
      const enabledKeys = new Set([
        ...(providerEnabledCategories.movies || []),
        ...(providerEnabledCategories.tvshows || []),
      ]);

      // Update categories with enabled status
      setCategories((allCategories || []).map(cat => ({
        ...cat,
        enabled: enabledKeys.has(cat.key),
      })));
    } catch (err) {
      console.error('Error loading categories:', err);
      setError(err.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [provider?.id, provider?.enabled_categories]);

  useEffect(() => {
    if (open && provider?.id) {
      loadCategories();
    }
  }, [open, provider?.id, loadCategories]);


  // Filter categories by media type and search query (no filtering by sync_media_types)
  const filteredCategories = useMemo(() => {
    let filtered = categories.filter(cat => {
      const type = cat.type;
      return (type === 'movies' || type === 'tvshows') && type !== 'live';
    });

    // Filter by media type filter only
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
  }, [categories, mediaTypeFilter, searchQuery]);

  // Check if there are enabled categories for disabled media types
  const hasWarning = useMemo(() => {
    if (!syncMediaTypes.movies || !syncMediaTypes.tvshows) {
      // Check if any enabled categories belong to disabled media types
      // Use current category enabled state (including pending changes)
      return categories.some(cat => {
        const isEnabled = pendingCategoryChanges.hasOwnProperty(cat.key)
          ? pendingCategoryChanges[cat.key]
          : cat.enabled;
        
        if (!isEnabled) return false;
        
        if (cat.type === 'movies' && !syncMediaTypes.movies) return true;
        if (cat.type === 'tvshows' && !syncMediaTypes.tvshows) return true;
        return false;
      });
    }
    return false;
  }, [categories, pendingCategoryChanges, syncMediaTypes]);

  // Handle sync media type toggle
  const handleSyncMediaTypeToggle = (mediaType) => {
    setSyncMediaTypes(prev => ({
      ...prev,
      [mediaType]: !prev[mediaType],
    }));
  };

  // Handle category toggle
  const handleCategoryToggle = (categoryKey, currentEnabled) => {
    setCategories(prev =>
      prev.map(cat =>
        cat.key === categoryKey
          ? { ...cat, enabled: !currentEnabled }
          : cat
      )
    );

    setPendingCategoryChanges(prev => ({
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
    if (hex.startsWith('#')) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    if (hex.startsWith('rgb')) {
      const matches = hex.match(/\d+/g);
      if (matches && matches.length >= 3) {
        return `rgba(${matches[0]}, ${matches[1]}, ${matches[2]}, ${opacity})`;
      }
    }
    return hex;
  };

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Update sync_media_types
      await axiosInstance.put(
        `${API_ENDPOINTS.providers}/${provider.id}/sync-media-types`,
        { sync_media_types: syncMediaTypes }
      );

      // Update enabled_categories (always save, regardless of sync state)
      const updatedEnabledCategories = {
        movies: [],
        tvshows: [],
      };

      categories.forEach(cat => {
        const categoryKey = cat.key;
        const type = cat.type;

        if (!type || (type !== 'movies' && type !== 'tvshows')) {
          return;
        }

        const shouldBeEnabled = pendingCategoryChanges.hasOwnProperty(categoryKey)
          ? pendingCategoryChanges[categoryKey]
          : cat.enabled;

        if (shouldBeEnabled) {
          updatedEnabledCategories[type].push(categoryKey);
        }
      });

      await axiosInstance.post(
        `${API_ENDPOINTS.providers}/${provider.id}/categories/batch`,
        { enabled_categories: updatedEnabledCategories }
      );

      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (open && provider) {
      setSyncMediaTypes(
        provider.sync_media_types || {
          movies: false,
          tvshows: false,
          live: false,
        }
      );
      setCategories([]);
      setPendingCategoryChanges({});
      setSearchQuery('');
      setMediaTypeFilter('all');
      setError(null);
    }
  }, [open, provider]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  const hasCategoriesToShow = filteredCategories.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="span">
          Manage Media Types: {provider?.id}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* Sync Media Types Toggles */}
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              Sync Media Types
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {['movies', 'tvshows', 'live'].map((mediaType) => {
                const colors = getMediaTypeColors(mediaType, theme);
                const isSelected = syncMediaTypes[mediaType] || false;
                return (
                  <Chip
                    key={mediaType}
                    label={getMediaTypeLabel(mediaType)}
                    onClick={() => handleSyncMediaTypeToggle(mediaType)}
                    variant={isSelected ? 'filled' : 'outlined'}
                    sx={{
                      backgroundColor: isSelected ? colors.main : 'transparent',
                      color: isSelected ? colors.contrastText : colors.main,
                      borderColor: colors.main,
                      borderWidth: 1,
                      borderStyle: 'solid',
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: isSelected ? colors.dark : colors.light,
                      },
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* Categories Section - Show all categories regardless of sync state */}
          {hasCategoriesToShow && (
            <>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 2 }}>
                  Categories
                </Typography>

                {error && (
                  <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                  </Alert>
                )}

                <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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

                {loading && categories.length === 0 ? (
                  <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                    <CircularProgress />
                  </Box>
                ) : filteredCategories.length === 0 ? (
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
                      maxHeight: '400px',
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
                          onClick={() => handleCategoryToggle(category.key, category.enabled)}
                          sx={{
                            border: `2px solid ${borderColor}`,
                            backgroundColor: isEnabled
                              ? hexToRgba(borderColor, 0.2)
                              : 'transparent',
                            color: isEnabled ? borderColor : 'text.secondary',
                            fontWeight: isEnabled ? 600 : 400,
                            cursor: 'pointer',
                            '&:hover': {
                              backgroundColor: isEnabled
                                ? hexToRgba(borderColor, 0.3)
                                : hexToRgba(borderColor, 0.1),
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
            </>
          )}

          {/* Warning if enabled categories exist for disabled media types */}
          {hasWarning && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Some categories are enabled for media types that are currently disabled. 
              These categories will not be synced until their media type is enabled.
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={isSaving}
        >
          {isSaving ? <CircularProgress size={20} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default MediaTypeDialog;

