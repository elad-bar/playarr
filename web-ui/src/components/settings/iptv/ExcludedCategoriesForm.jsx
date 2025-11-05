import React, { useState } from 'react';
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
} from '@mui/material';
import { updateIPTVProviderCategory } from './utils';

function ExcludedCategoriesForm({ provider, categoryType, categories, loading, onCategoryUpdate }) {
  const [error, setError] = useState(null);
  const [localCategories, setLocalCategories] = useState(categories || []);
  const filteredCategories = localCategories?.filter(cat => cat.type === categoryType) || [];

  // Update local state when categories prop changes
  React.useEffect(() => {
    setLocalCategories(categories || []);
  }, [categories]);

  const handleToggleEnabled = async (categoryKey, currentEnabled) => {
    try {
      // Optimistically update the UI
      setLocalCategories(prev =>
        prev.map(cat =>
          cat.key === categoryKey
            ? { ...cat, enabled: !currentEnabled }
            : cat
        )
      );

      // Make API call
      await updateIPTVProviderCategory(provider.id, categoryKey, {
        enabled: !currentEnabled,
        type: categoryType
      });

      // No need to refresh all categories
      setError(null);
    } catch (err) {
      // Revert the optimistic update on error
      setLocalCategories(prev =>
        prev.map(cat =>
          cat.key === categoryKey
            ? { ...cat, enabled: currentEnabled }
            : cat
        )
      );
      console.error('Error updating category:', err);
      setError('Failed to update category status');
    }
  };

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

  return (
    <Box>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Typography variant="subtitle2" gutterBottom>
            Categories
          </Typography>
          {filteredCategories.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography color="textSecondary" sx={{ fontStyle: 'italic' }}>
                No categories available
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
