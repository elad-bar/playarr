import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * CleanupRulesPreview - Preview component for Cleanup Rules step
 * @param {Object} data - Step data { cleanup }
 * @param {Object} provider - Provider object
 */
function CleanupRulesPreview({ data, provider }) {
  const cleanup = data?.cleanup || provider?.cleanup || {};
  const patterns = cleanup.patterns || [];
  const replacements = cleanup.replacements || [];

  if (patterns.length === 0 && replacements.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        No cleanup rules configured
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {patterns.length > 0 && (
        <Chip
          label={`${patterns.length} pattern${patterns.length > 1 ? 's' : ''}`}
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {replacements.length > 0 && (
        <Chip
          label={`${replacements.length} replacement${replacements.length > 1 ? 's' : ''}`}
          size="small"
          color="secondary"
          variant="outlined"
        />
      )}
      <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', ml: 'auto' }} />
    </Box>
  );
}

export default CleanupRulesPreview;

