import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import { fetchIPTVProviderIgnoredTitles } from './utils';

/**
 * Component to display ignored titles for an IPTV provider
 * Shows title name (with year), type, and the issue that caused it to be ignored
 */
function IgnoredTitlesForm({ provider }) {
  const [ignoredTitles, setIgnoredTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadIgnoredTitles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchIPTVProviderIgnoredTitles(provider.id);
      setIgnoredTitles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching ignored titles:', err);
      setError('Failed to load ignored titles');
      setIgnoredTitles([]);
    } finally {
      setLoading(false);
    }
  }, [provider?.id]);

  useEffect(() => {
    if (provider?.id) {
      loadIgnoredTitles();
    } else {
      setIgnoredTitles([]);
      setLoading(false);
    }
  }, [provider?.id, loadIgnoredTitles]);

  // Parse title key to extract type and ID
  const parseTitleKey = (titleKey) => {
    const match = titleKey.match(/^(movies|tvshows)-(.+)$/);
    if (match) {
      return {
        type: match[1],
        id: match[2]
      };
    }
    return {
      type: 'unknown',
      id: titleKey
    };
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

  if (ignoredTitles.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="textSecondary" sx={{ fontStyle: 'italic' }}>
          No ignored titles found for this provider.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
        Ignored Titles ({ignoredTitles.length})
      </Typography>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        These titles were ignored during processing. In the future, you will be able to remove them from this list.
      </Typography>
      
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Issue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ignoredTitles.map((item, index) => {
              const parsed = parseTitleKey(item.title_key);
              const displayName = item.name 
                ? `${item.name}${item.year ? ` (${item.year})` : ''}`
                : item.title_key;
              
              return (
                <TableRow
                  key={item.title_key}
                  sx={{
                    backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                    '&:hover': {
                      backgroundColor: 'action.selected',
                    }
                  }}
                >
                  <TableCell>
                    <Typography variant="body2">
                      {displayName}
                    </Typography>
                    {item.name && (
                      <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace', display: 'block', mt: 0.5 }}>
                        {item.title_key}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={parsed.type === 'movies' ? 'Movie' : parsed.type === 'tvshows' ? 'TV Show' : 'Unknown'}
                      size="small"
                      color={parsed.type === 'movies' ? 'primary' : parsed.type === 'tvshows' ? 'secondary' : 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="textSecondary">
                      {item.issue}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default IgnoredTitlesForm;

