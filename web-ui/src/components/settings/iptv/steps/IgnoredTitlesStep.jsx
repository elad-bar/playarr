import React from 'react';
import { Box, Typography } from '@mui/material';
import IgnoredTitlesForm from '../IgnoredTitlesForm';

/**
 * IgnoredTitlesStep - Step 5 (edit mode only)
 * @param {Object} provider - Provider object
 */
function IgnoredTitlesStep({ provider }) {
  return (
    <Box sx={{ maxWidth: 1200 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Titles that have been ignored for this provider. This list is read-only.
      </Typography>
      <IgnoredTitlesForm provider={provider} />
    </Box>
  );
}

export default IgnoredTitlesStep;

