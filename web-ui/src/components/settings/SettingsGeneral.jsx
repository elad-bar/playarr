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
    Box
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

const SettingsGeneral = () => {
    const [tmdbApiKey, setTmdbApiKey] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showApiKey, setShowApiKey] = useState(false);
    
    // Add state for log unmanaged endpoints
    const [logUnmanagedEndpoints, setLogUnmanagedEndpoints] = useState(false);
    const [isSavingLogSetting, setIsSavingLogSetting] = useState(false);

    // Fetch all settings on mount
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                // Fetch TMDB API key
                const tmdbResponse = await axiosInstance.get(API_ENDPOINTS.settings.tmdbToken);
                setTmdbApiKey(tmdbResponse.data.value || '');
                
                // Fetch log unmanaged endpoints setting
                const logResponse = await axiosInstance.get(API_ENDPOINTS.settings.logUnmanagedEndpoints);
                setLogUnmanagedEndpoints(logResponse.data.value === true);
            } catch (error) {
                // handle error if needed
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSaveTmdbApiKey = async () => {
        setIsSaving(true);
        try {
            await axiosInstance.post(API_ENDPOINTS.settings.tmdbToken, { value: tmdbApiKey });
        } catch (error) {
            // handle error if needed
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveLogSetting = async () => {
        setIsSavingLogSetting(true);
        try {
            await axiosInstance.post(API_ENDPOINTS.settings.logUnmanagedEndpoints, { 
                value: logUnmanagedEndpoints 
            });
        } catch (error) {
            // handle error if needed
        } finally {
            setIsSavingLogSetting(false);
        }
    };

    if (isLoading) {
        return <CircularProgress />;
    }

    return (
        <Box sx={{ p: 3 }}>
            <Grid container spacing={3}>
                {/* TMDB Provider Card */}
                <Grid item xs={12} sm={6} md={4} lg={3}>
                    <Card sx={{ height: '100%' }}>
                        <CardHeader 
                            title="TMDB Provider"
                            subheader="Configure TMDB API settings"
                            action={
                                <Tooltip title="Save settings">
                                    <IconButton
                                        onClick={handleSaveTmdbApiKey}
                                        disabled={isSaving}
                                        color="primary"
                                        aria-label="save tmdb settings"
                                    >
                                        {isSaving ? <CircularProgress size={24} /> : <SaveIcon />}
                                    </IconButton>
                                </Tooltip>
                            }
                        />
                        <CardContent>
                            <TextField
                                label="TMDB API Key"
                                value={tmdbApiKey}
                                onChange={(e) => setTmdbApiKey(e.target.value)}
                                fullWidth
                                type={showApiKey ? 'text' : 'password'}
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
                            action={
                                <Tooltip title="Save settings">
                                    <IconButton
                                        onClick={handleSaveLogSetting}
                                        disabled={isSavingLogSetting}
                                        color="primary"
                                        aria-label="save debug settings"
                                    >
                                        {isSavingLogSetting ? <CircularProgress size={24} /> : <SaveIcon />}
                                    </IconButton>
                                </Tooltip>
                            }
                        />
                        <CardContent>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={logUnmanagedEndpoints}
                                        onChange={(e) => setLogUnmanagedEndpoints(e.target.checked)}
                                        disabled={isSavingLogSetting}
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
