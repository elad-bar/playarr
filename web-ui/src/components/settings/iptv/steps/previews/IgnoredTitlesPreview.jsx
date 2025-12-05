import React from 'react';
import { Typography } from '@mui/material';

/**
 * IgnoredTitlesPreview - Preview component for Ignored Titles step
 * @param {Object} provider - Provider object
 */
function IgnoredTitlesPreview({ provider }) {
  // This is a read-only step, so we just show a message
  return (
    <Typography variant="body2" color="text.secondary">
      View ignored titles for this provider
    </Typography>
  );
}

export default IgnoredTitlesPreview;

