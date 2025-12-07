import React, { useMemo } from 'react';
import { Box, Paper, Typography, Button, Link } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { API_URL } from '../../config';

/**
 * Displays Prometheus metrics entry point and helper actions.
 */
const SettingsMetrics = () => {
  const metricsUrl = useMemo(() => {
    const base = API_URL.startsWith('http://') || API_URL.startsWith('https://')
      ? API_URL.replace(/\/$/, '')
      : `${window.location.origin}${API_URL.replace(/\/$/, '')}`;
    return `${base}/metrics`;
  }, []);

  const handleOpenMetrics = () => {
    window.open(metricsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Prometheus Metrics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The service exposes Prometheus-compatible metrics at the /metrics endpoint.
          Use this to scrape runtime health and performance indicators.
        </Typography>
        <Button
          variant="contained"
          color="primary"
          endIcon={<OpenInNewIcon />}
          onClick={handleOpenMetrics}
          sx={{ mr: 1 }}
        >
          Open /metrics
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Endpoint:&nbsp;
          <Link href={metricsUrl} target="_blank" rel="noopener noreferrer">
            {metricsUrl}
          </Link>
        </Typography>
      </Paper>
    </Box>
  );
};

export default SettingsMetrics;

