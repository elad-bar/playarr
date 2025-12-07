import React, { useState, useEffect } from 'react';
import { 
    TextField, 
    CircularProgress, 
    InputAdornment, 
    IconButton, 
    Tooltip, 
    FormControlLabel, 
    Checkbox,
    Card,
    CardContent,
    CardHeader,
    Grid,
    Box,
    Button,
    Alert,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

const SettingsGeneral = () => {
    const [tmdbApiKey, setTmdbApiKey] = useState('');
    const [originalTmdbApiKey, setOriginalTmdbApiKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showApiKey, setShowApiKey] = useState(false);
    const [success, setSuccess] = useState(null);
    const [error, setError] = useState(null);
    
    // Add state for log unmanaged endpoints
    const [logUnmanagedEndpoints, setLogUnmanagedEndpoints] = useState(false);
    const [originalLogUnmanagedEndpoints, setOriginalLogUnmanagedEndpoints] = useState(false);

    // Fetch all settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                // Fetch TMDB API key
                const tmdbResponse = await axiosInstance.get(API_ENDPOINTS.settings.tmdbToken);
                const tmdbValue = tmdbResponse.data.value || '';
                setTmdbApiKey(tmdbValue);
                setOriginalTmdbApiKey(tmdbValue);
                
                // Fetch log unmanaged endpoints setting
                const logResponse = await axiosInstance.get(API_ENDPOINTS.settings.logUnmanagedEndpoints);
                const logValue = logResponse.data.value === true;
                setLogUnmanagedEndpoints(logValue);
                setOriginalLogUnmanagedEndpoints(logValue);
            } catch (error) {
                setError('Failed to load settings');
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    // Check if any values are dirty (changed)
    // Use useEffect to ensure isDirty is calculated after state updates
    const [isDirty, setIsDirty] = useState(false);
    
    useEffect(() => {
        const dirty = tmdbApiKey !== originalTmdbApiKey || 
                     logUnmanagedEndpoints !== originalLogUnmanagedEndpoints;
        setIsDirty(dirty);
    }, [tmdbApiKey, originalTmdbApiKey, logUnmanagedEndpoints, originalLogUnmanagedEndpoints]);

    const handleSaveAll = async () => {
        if (!isDirty) return;

        setIsSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const savePromises = [];

            // Save TMDB API key if changed
            if (tmdbApiKey !== originalTmdbApiKey) {
                savePromises.push(
                    axiosInstance.post(API_ENDPOINTS.settings.tmdbToken, { value: tmdbApiKey })
                );
            }

            // Save log setting if changed
            if (logUnmanagedEndpoints !== originalLogUnmanagedEndpoints) {
                savePromises.push(
                    axiosInstance.post(API_ENDPOINTS.settings.logUnmanagedEndpoints, { 
                        value: logUnmanagedEndpoints 
                    })
                );
            }

            // Save all changed values
            await Promise.all(savePromises);

            // Update original values to reflect saved state
            setOriginalTmdbApiKey(tmdbApiKey);
            setOriginalLogUnmanagedEndpoints(logUnmanagedEndpoints);

            setSuccess('Settings saved successfully');
            setTimeout(() => setSuccess(null), 3000);
        } catch (error) {
            setError(error.response?.data?.error || error.message || 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <CircularProgress />;
    }

    return (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {/* Save Button - Always Visible */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'flex-end' }}>
                <Button
                    variant="contained"
                    startIcon={isSaving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                    onClick={handleSaveAll}
                    disabled={!isDirty || isSaving}
                    sx={{
                        minWidth: '120px',
                        backgroundColor: isDirty && !isSaving ? '#1976d2' : '#bdbdbd',
                        color: isDirty && !isSaving ? '#ffffff' : '#424242',
                        '&:hover': {
                            backgroundColor: isDirty && !isSaving ? '#1565c0' : '#bdbdbd',
                        },
                        '&:disabled': {
                            backgroundColor: '#bdbdbd',
                            color: '#424242',
                            opacity: 1,
                        },
                    }}
                >
                    Save
                </Button>
            </Box>

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
                {/* TMDB Provider Card */}
                <Grid item xs={12} sm={6} md={4} lg={3}>
                    <Card sx={{ height: '100%' }}>
                        <CardHeader 
                            title="TMDB Provider"
                            subheader="Configure TMDB API settings"
                        />
                        <CardContent>
                            <TextField
                                label="TMDB API Key"
                                value={tmdbApiKey}
                                onChange={(e) => setTmdbApiKey(e.target.value)}
                                fullWidth
                                type={showApiKey ? 'text' : 'password'}
                                disabled={isSaving}
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <Tooltip title={showApiKey ? 'Hide API key' : 'Show API key'}>
                                                <IconButton
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    edge="end"
                                                    aria-label="toggle api key visibility"
                                                >
                                                    {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                                </IconButton>
                                            </Tooltip>
                                        </InputAdornment>
                                    )
                                }}
                            />
                        </CardContent>
                    </Card>
                </Grid>

                {/* Debug Card */}
                <Grid item xs={12} sm={6} md={4} lg={3}>
                    <Card sx={{ height: '100%' }}>
                        <CardHeader 
                            title="Debug"
                            subheader="Debug and logging settings"
                        />
                        <CardContent>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={logUnmanagedEndpoints}
                                        onChange={(e) => setLogUnmanagedEndpoints(e.target.checked)}
                                        disabled={isSaving}
                                    />
                                }
                                label="Log unmanaged endpoints"
                            />
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default SettingsGeneral;
