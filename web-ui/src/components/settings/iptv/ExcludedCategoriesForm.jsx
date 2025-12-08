import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Grid,
  Switch,
  TextField,
  InputAdornment,
  IconButton,
  Button,
  Alert,
  Snackbar,
} from '@mui/material';
import { SearchOutlined as SearchIcon, ClearOutlined as ClearIcon, SaveOutlined as SaveIcon } from '@mui/icons-material';
import axiosInstance from '../../../config/axios';
import { API_ENDPOINTS } from '../../../config/api';

function ExcludedCategoriesForm({ provider, categoryType, categories, loading, onCategoryUpdate }) {
  const [error, setError] = useState(null);
  const [localCategories, setLocalCategories] = useState(categories || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingChanges, setPendingChanges] = useState({}); // { [categoryKey]: enabled }
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Filter categories by type and search query
  const filteredCategories = useMemo(() => {
    let filtered = localCategories?.filter(cat => cat.type === categoryType) || [];
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(cat => {
        const name = (cat.category_name || cat.name || cat.key || '').toLowerCase();
        return name.includes(query);
      });
    }
    
    return filtered;
  }, [localCategories, categoryType, searchQuery]);

  // Update local state when categories prop changes
  React.useEffect(() => {
    setLocalCategories(categories || []);
    setPendingChanges({}); // Clear pending changes when categories change
  }, [categories]);

  const handleToggleEnabled = (categoryKey, currentEnabled) => {
    // Update local state immediately for UI feedback
    setLocalCategories(prev =>
      prev.map(cat =>
        cat.key === categoryKey
          ? { ...cat, enabled: !currentEnabled }
          : cat
      )
    );

    // Track pending change
    setPendingChanges(prev => ({
      ...prev,
      [categoryKey]: !currentEnabled
    }));

    setError(null);
  };

  const handleSave = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      return; // No changes to save
    }

    setIsSaving(true);
    setError(null);

    try {
      // Get all categories for this provider (categories prop should contain all)
      // Start with original categories and apply pending changes
      const allCategories = categories || [];
      
      // Build enabled categories object
      const enabledCategories = {
        movies: [],
        tvshows: []
      };

      // Process all categories and apply pending changes
      allCategories.forEach(cat => {
        const categoryKey = cat.key;
        const type = cat.type;
        
        if (!type || (type !== 'movies' && type !== 'tvshows')) {
          return; // Skip invalid types
        }
        
        // Determine if category should be enabled
        // If there's a pending change, use that; otherwise use current enabled status
        const shouldBeEnabled = pendingChanges.hasOwnProperty(categoryKey)
          ? pendingChanges[categoryKey]
          : cat.enabled;

        if (shouldBeEnabled) {
          enabledCategories[type].push(categoryKey);
        }
      });

      // Make batch update API call
      const response = await axiosInstance.post(
        `${API_ENDPOINTS.providerCategories(provider.id)}/batch`,
        { enabled_categories: enabledCategories }
      );

      if (response.data.success) {
        setPendingChanges({});
        setSaveSuccess(true);
        
        // Notify parent component to refresh categories
        if (onCategoryUpdate) {
          onCategoryUpdate();
        }
      } else {
        throw new Error(response.data.error || 'Failed to save categories');
      }
    } catch (err) {
      console.error('Error saving categories:', err);
      setError(err.response?.data?.error || 'Failed to save categories');
      
      // Revert local changes on error
      setLocalCategories(categories || []);
      setPendingChanges({});
    } finally {
      setIsSaving(false);
    }
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  // Split categories into two arrays for two columns
  const midPoint = Math.ceil(filteredCategories.length / 2);
  const leftColumnCategories = filteredCategories.slice(0, midPoint);
  const rightColumnCategories = filteredCategories.slice(midPoint);

  const CategoryList = ({ items }) => (
    <List dense sx={{ height: '100%', overflowY: 'auto' }}>
      {items.map((category, index) => (
        <ListItem
          key={category.key}
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
            '&:hover': {
              backgroundColor: 'rgba(33, 150, 243, 0.08)', // Light blue with opacity
              transition: 'background-color 0.2s ease',
            },
            transition: 'background-color 0.2s ease',
          }}
        >
          <ListItemText
            primary={category.category_name || category.name || category.key || 'Unknown Category'}
            sx={{
              '& .MuiListItemText-primary': {
                fontFamily: 'Arial, sans-serif',
                fontSize: '0.9rem',
                direction: 'ltr',
              }
            }}
          />
          <ListItemSecondaryAction>
            <Switch
              edge="end"
              checked={category.enabled}
              onChange={() => handleToggleEnabled(category.key, category.enabled)}
              color="primary"
            />
          </ListItemSecondaryAction>
        </ListItem>
      ))}
    </List>
  );

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <Box>
      <Snackbar
        open={saveSuccess}
        autoHideDuration={3000}
        onClose={() => setSaveSuccess(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setSaveSuccess(false)} severity="success" sx={{ width: '100%' }}>
          Categories saved successfully
        </Alert>
      </Snackbar>

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2">
              Categories
            </Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={!hasPendingChanges || isSaving || loading}
              size="small"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Box>
          
          {/* Search Filter */}
          <TextField
            fullWidth
            placeholder="Search categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            sx={{ mb: 2 }}
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

          {filteredCategories.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="textSecondary" sx={{ fontStyle: 'italic' }}>
                {searchQuery.trim() 
                  ? `No categories found matching "${searchQuery}"` 
                  : 'No categories available'}
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Paper
                  variant="outlined"
                  sx={{
                    height: '100%',
                    minHeight: '200px',
                    overflow: 'hidden'
                  }}
                >
                  <CategoryList items={leftColumnCategories} />
                </Paper>
              </Grid>
              <Grid item xs={6}>
                <Paper
                  variant="outlined"
                  sx={{
                    height: '100%',
                    minHeight: '200px',
                    overflow: 'hidden'
                  }}
                >
                  <CategoryList items={rightColumnCategories} />
                </Paper>
              </Grid>
            </Grid>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}

export default ExcludedCategoriesForm;
