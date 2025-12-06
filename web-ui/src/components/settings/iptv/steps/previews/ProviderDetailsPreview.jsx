import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';

/**
 * ProviderDetailsPreview - Preview component for Provider Details step
 * @param {Object} data - Step data { urls, apiUrlIndex, username, password }
 * @param {Object} provider - Provider object (for edit mode)
 */
function ProviderDetailsPreview({ data, provider }) {
  const urls = data?.urls || provider?.streams_urls || [];
  const apiUrlIndex = data?.apiUrlIndex !== undefined 
    ? data.apiUrlIndex 
    : (provider?.api_url && provider?.streams_urls 
      ? provider.streams_urls.findIndex(url => url === provider.api_url) 
      : 0);
  const hasUsername = !!(data?.username || provider?.username);
  const hasPassword = !!(data?.password || provider?.password);

  if (urls.length === 0 && !hasUsername && !hasPassword) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        Not configured
      </Typography>
    );
  }

  const apiUrl = urls[apiUrlIndex] || urls[0] || '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {urls.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label={`${urls.length} URL${urls.length > 1 ? 's' : ''}`}
            size="small"
            color="primary"
            variant="outlined"
          />
          {apiUrl && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <StarIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                API: {apiUrl.length > 40 ? `${apiUrl.substring(0, 40)}...` : apiUrl}
              </Typography>
            </Box>
          )}
        </Box>
      )}
      {hasUsername && hasPassword && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label="Credentials configured"
            size="small"
            color="success"
            variant="outlined"
          />
          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
        </Box>
      )}
    </Box>
  );
}

export default ProviderDetailsPreview;

