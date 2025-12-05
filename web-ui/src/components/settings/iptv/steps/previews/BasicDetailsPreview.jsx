import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * BasicDetailsPreview - Preview component for Basic Details step
 * @param {Object} data - Step data { id, type }
 */
function BasicDetailsPreview({ data }) {
  if (!data?.id && !data?.type) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        Not configured
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {data.id && (
        <Chip
          label={`ID: ${data.id}`}
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
      {data.type && (
        <Chip
          label={`Type: ${data.type.toUpperCase()}`}
          size="small"
          color="secondary"
          variant="outlined"
        />
      )}
      <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main', ml: 'auto' }} />
    </Box>
  );
}

export default BasicDetailsPreview;

