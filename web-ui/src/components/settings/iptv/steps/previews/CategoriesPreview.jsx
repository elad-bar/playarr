import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';

/**
 * CategoriesPreview - Preview component for Categories step
 * @param {Object} data - Step data { enabled_categories }
 * @param {Object} provider - Provider object
 */
function CategoriesPreview({ data, provider }) {
  const enabledCategories = data?.enabled_categories || provider?.enabled_categories || { movies: [], tvshows: [] };
  const moviesCount = enabledCategories.movies?.length || 0;
  const tvshowsCount = enabledCategories.tvshows?.length || 0;
  const totalCount = moviesCount + tvshowsCount;

  if (totalCount === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        No categories enabled
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {moviesCount > 0 && (
        <Chip
          icon={<MovieIcon sx={{ fontSize: 16 }} />}
          label={`${moviesCount} movie${moviesCount > 1 ? 's' : ''}`}
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {tvshowsCount > 0 && (
        <Chip
          icon={<TvIcon sx={{ fontSize: 16 }} />}
          label={`${tvshowsCount} TV show${tvshowsCount > 1 ? 's' : ''}`}
          size="small"
          color="secondary"
          variant="outlined"
        />
      )}
      <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', ml: 'auto' }} />
    </Box>
  );
}

export default CategoriesPreview;

