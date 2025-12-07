import React, { useState, useEffect } from 'react';
import {
    TextField,
    CircularProgress,
    InputAdornment,
    IconButton,
    Tooltip,
    Card,
    CardContent,
    CardHeader,
    Grid,
    Box,
    Button,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

const SettingsMetrics = () => {
    const [metricsToken, setMetricsToken] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showToken, setShowToken] = useState(false);
    const [success, setSuccess] = useState(null);
    const [error, setError] = useState(null);
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    // Fetch metrics token on mount
    useEffect(() => {
        const fetchMetricsToken = async () => {
            try {
                const response = await axiosInstance.get(API_ENDPOINTS.settings.metrics);
                const tokenValue = response.data.value || '';
                setMetricsToken(tokenValue);
                if (!tokenValue) {
                    setError('Metrics token not found. Please regenerate the token.');
                }
            } catch (error) {
                const errorMessage = error.response?.data?.error || error.message || 'Failed to load metrics token';
                setError(`Failed to load metrics token: ${errorMessage}`);
            } finally {
                setIsLoading(false);
            }
        };
        fetchMetricsToken();
    }, []);

    const handleCopyToken = async () => {
        try {
            await navigator.clipboard.writeText(metricsToken);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            setError('Failed to copy token to clipboard');
        }
    };

    const handleRegenerateToken = async () => {
        setIsSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await axiosInstance.post(API_ENDPOINTS.settings.metricsRegenerate);
            const newToken = response.data.value;
            setMetricsToken(newToken);
            setRegenerateDialogOpen(false);
            setSuccess('Metrics token regenerated successfully. Update your Prometheus configuration with the new token.');
            setTimeout(() => setSuccess(null), 5000);
        } catch (error) {
            setError(error.response?.data?.error || error.message || 'Failed to regenerate metrics token');
        } finally {
            setIsSaving(false);
        }
    };

    const getPrometheusConfig = () => {
        if (!metricsToken) return '';
        return `scrape_configs:
  - job_name: 'playarr'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3000']
    bearer_token: '${metricsToken}'`;
    };

    if (isLoading) {
        return <CircularProgress />;
    }

    return (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {success && (
                <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
                    {success}
                </Alert>
            )}

            <Grid container spacing={3}>
                {/* Metrics Token Card */}
                <Grid item xs={12} md={6}>
                    <Card sx={{ height: '100%' }}>
                        <CardHeader
                            title="Metrics Token"
                            subheader="Bearer token for Prometheus authentication"
                        />
                        <CardContent>
                            <TextField
                                label="Metrics Token"
                                value={metricsToken}
                                fullWidth
                                type={showToken ? 'text' : 'password'}
                                disabled={isSaving}
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <Tooltip title={showToken ? 'Hide token' : 'Show token'}>
                                                <IconButton
                                                    onClick={() => setShowToken(!showToken)}
                                                    edge="end"
                                                    aria-label="toggle token visibility"
                                                >
                                                    {showToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title={copied ? 'Copied!' : 'Copy token'}>
                                                <IconButton
                                                    onClick={handleCopyToken}
                                                    edge="end"
                                                    aria-label="copy token"
                                                >
                                                    <ContentCopyIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </InputAdornment>
                                    )
                                }}
                            />
                            <Box sx={{ mt: 2 }}>
                                <Button
                                    variant="outlined"
                                    startIcon={<RefreshIcon />}
                                    onClick={() => setRegenerateDialogOpen(true)}
                                    disabled={isSaving}
                                    color="warning"
                                >
                                    Regenerate Token
                                </Button>
                            </Box>
                            <Alert severity="warning" sx={{ mt: 2 }}>
                                Regenerating the token will invalidate the current token. You must update your Prometheus configuration with the new token.
                            </Alert>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Prometheus Configuration Card */}
                <Grid item xs={12} md={6}>
                    <Card sx={{ height: '100%' }}>
                        <CardHeader
                            title="Prometheus Configuration"
                            subheader="Example configuration for Prometheus"
                        />
                        <CardContent>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                Add this configuration to your Prometheus <code>prometheus.yml</code> file:
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={8}
                                value={getPrometheusConfig()}
                                InputProps={{
                                    readOnly: true,
                                    sx: {
                                        fontFamily: 'monospace',
                                        fontSize: '0.875rem',
                                        bgcolor: 'grey.900',
                                        color: 'grey.100',
                                        '& .MuiOutlinedInput-notchedOutline': {
                                            borderColor: 'grey.700',
                                        },
                                        '&:hover .MuiOutlinedInput-notchedOutline': {
                                            borderColor: 'grey.600',
                                        },
                                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                            borderColor: 'primary.main',
                                        },
                                    }
                                }}
                                sx={{ mb: 2 }}
                            />
                            <Button
                                variant="contained"
                                startIcon={<ContentCopyIcon />}
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(getPrometheusConfig());
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    } catch (error) {
                                        setError('Failed to copy configuration to clipboard');
                                    }
                                }}
                                disabled={!metricsToken}
                                fullWidth
                            >
                                {copied ? 'Copied!' : 'Copy Configuration'}
                            </Button>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Regenerate Token Confirmation Dialog */}
            <Dialog
                open={regenerateDialogOpen}
                onClose={() => setRegenerateDialogOpen(false)}
            >
                <DialogTitle>Regenerate Metrics Token</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to regenerate the metrics token? The current token will be invalidated and you will need to update your Prometheus configuration with the new token.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRegenerateDialogOpen(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRegenerateToken}
                        color="warning"
                        variant="contained"
                        disabled={isSaving}
                        startIcon={isSaving ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
                    >
                        Regenerate
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default SettingsMetrics;

