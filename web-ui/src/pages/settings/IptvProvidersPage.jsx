import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Button,
  Chip,
  useTheme,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  fetchIPTVProviders,
  deleteIPTVProvider,
  getProviderTypeColor,
  getMediaTypeLabel,
  getMediaTypeColors,
  fetchProviderCounts,
} from '../../components/settings/iptv/utils';
import ProviderEditorDialog from '../../components/settings/iptv/ProviderEditorDialog';
import MediaTypeDialog from '../../components/settings/iptv/MediaTypeDialog';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

function SettingsIPTVProviders() {
  const theme = useTheme();
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [isNewProvider, setIsNewProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [editorDialogOpen, setEditorDialogOpen] = useState(false);
  const [mediaTypeDialogOpen, setMediaTypeDialogOpen] = useState(false);
  const [providerCounts, setProviderCounts] = useState({}); // { providerId: { movies, tvshows, live } }

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchIPTVProviders();
      // Sort providers alphabetically by id
      const sortedData = [...data].sort((a, b) => {
        const idA = (a.id || '').toLowerCase();
        const idB = (b.id || '').toLowerCase();
        return idA.localeCompare(idB);
      });
      setProviders(sortedData);
    } catch (error) {
      console.error('Error fetching providers:', error);
      setError('Failed to load providers. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // Load counts for all providers
  useEffect(() => {
    const loadCounts = async () => {
      if (providers.length === 0) return;
      
      const countsPromises = providers.map(async (provider) => {
        try {
          const counts = await fetchProviderCounts(provider.id);
          return { providerId: provider.id, counts };
        } catch (error) {
          console.error(`Error loading counts for ${provider.id}:`, error);
          return { providerId: provider.id, counts: { movies: 0, tvshows: 0, live: 0 } };
        }
      });

      const results = await Promise.all(countsPromises);
      const countsMap = {};
      results.forEach(({ providerId, counts }) => {
        countsMap[providerId] = counts;
      });
      setProviderCounts(countsMap);
    };

    loadCounts();
  }, [providers]);

  const handleEdit = (provider) => {
    setSelectedProvider(provider);
    setIsNewProvider(false);
    setEditorDialogOpen(true);
  };

  const handleAdd = (providerType = null) => {
    setSelectedProvider(providerType ? { type: providerType } : null);
    setIsNewProvider(true);
    setEditorDialogOpen(true);
  };

  const handleCloseEditorDialog = () => {
    setEditorDialogOpen(false);
    setTimeout(() => {
      setSelectedProvider(null);
      setIsNewProvider(false);
    }, 100);
  };

  const handleOpenMediaTypeDialog = (provider) => {
    setSelectedProvider(provider);
    setMediaTypeDialogOpen(true);
  };

  const handleCloseMediaTypeDialog = () => {
    setMediaTypeDialogOpen(false);
    loadProviders(); // Reload to get updated sync_media_types
  };

  const handleToggleEnabled = async (provider, enabled) => {
    try {
      await axiosInstance.put(`${API_ENDPOINTS.providers}/${provider.id}/enabled`, { enabled });
      setSuccess(`Provider ${enabled ? 'enabled' : 'disabled'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
      loadProviders();
    } catch (error) {
      console.error('Error toggling provider enabled state:', error);
      setError(`Failed to ${enabled ? 'enable' : 'disable'} provider`);
    }
  };

  const handleDelete = async (providerId) => {
    try {
      await deleteIPTVProvider(providerId);
      setSuccess('Provider deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      if (selectedProvider?.id === providerId) {
        handleCloseEditorDialog();
      }
      loadProviders();
    } catch (error) {
      console.error('Error deleting provider:', error);
      setError('Failed to delete provider');
    }
  };

  const handleSave = async (savedProvider) => {
    try {
      setSuccess(isNewProvider ? 'Provider added successfully' : 'Provider updated successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Reload providers to get fresh data (this will also sort them)
      loadProviders();

      setSelectedProvider(savedProvider);
      setIsNewProvider(false);
      handleCloseEditorDialog();
    } catch (error) {
      console.error('Error saving provider:', error);
      setError('Failed to save provider');
    }
  };

  const handleSaveAndManageMediaTypes = async (savedProvider) => {
    try {
      setSuccess('Provider added successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Reload providers to get fresh data
      await loadProviders();

      // Close editor dialog and open media type dialog
      handleCloseEditorDialog();
      setSelectedProvider(savedProvider);
      setMediaTypeDialogOpen(true);
    } catch (error) {
      console.error('Error saving provider:', error);
      setError('Failed to save provider');
    }
  };

  const handleMediaTypeDialogSave = () => {
    handleCloseMediaTypeDialog();
    loadProviders(); // Reload to refresh counts
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: { xs: 2, sm: 3 } }}>
        <CircularProgress />
      </Box>
    );
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

      <Box>
        {/* Add Provider Buttons */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleAdd('xtream')}
            sx={{
              backgroundColor: getProviderTypeColor('xtream'),
              color: '#ffffff',
              '&:hover': {
                backgroundColor: '#C0392B', // Darker red
              },
            }}
          >
            Add Xtream Code
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleAdd('agtv')}
            sx={{
              backgroundColor: getProviderTypeColor('agtv'),
              color: '#ffffff',
              '&:hover': {
                backgroundColor: '#16A085', // Darker teal
              },
            }}
          >
            Add Apollo Group TV
          </Button>
        </Box>

          {/* Provider Cards */}
        <Grid container spacing={3}>
          {providers.map((provider) => (
            <Grid item xs={12} sm={6} md={4} lg={2} xl={2} key={provider.id}>
              <Card sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                minHeight: 200,
                borderBottom: `2px ${provider.enabled ? 'solid' : 'dashed'} ${getProviderTypeColor(provider.type)}`
              }}>
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  {/* Title with Provider ID and Connections */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontFamily: 'monospace', flex: 1 }}>
                      {(() => {
                        const maxConnections = provider.provider_details?.max_connections;
                        const activeConnections = provider.provider_details?.active_connections;
                        const isAGTV = provider.type?.toLowerCase() === 'agtv';
                        
                        if (maxConnections !== null && maxConnections !== undefined) {
                          // For AGTV, only show maximum (no active connections)
                          if (isAGTV) {
                            return `${provider.id} (${maxConnections})`;
                          }
                          // For other providers (like Xtream), show active/maximum if both exist
                          if (activeConnections !== null && activeConnections !== undefined) {
                            return `${provider.id} (${activeConnections}/${maxConnections})`;
                          } else {
                            return `${provider.id} (${maxConnections})`;
                          }
                        }
                        return provider.id;
                      })()}
                    </Typography>
                  </Box>

                  {/* Sync Media Types Chips */}
                  {provider.sync_media_types && (
                    <Box sx={{ mt: 1, mb: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {Object.entries(provider.sync_media_types).map(([mediaType, enabled]) => {
                          const colors = getMediaTypeColors(mediaType, theme);
                          const counts = providerCounts[provider.id] || { movies: 0, tvshows: 0, live: 0 };
                          const count = counts[mediaType] || 0;
                          const showCount = enabled || count > 0;
                          
                          return (
                            <Chip
                              key={mediaType}
                              label={showCount ? `${getMediaTypeLabel(mediaType)} (${count.toLocaleString()})` : getMediaTypeLabel(mediaType)}
                              size="small"
                              variant={enabled ? 'filled' : 'outlined'}
                              onClick={() => handleOpenMediaTypeDialog(provider)}
                              sx={{
                                backgroundColor: enabled ? colors.main : 'transparent',
                                color: enabled ? colors.contrastText : colors.main,
                                borderColor: colors.main,
                                borderWidth: 1,
                                borderStyle: 'solid',
                                fontSize: '0.7rem',
                                height: '24px',
                                cursor: 'pointer',
                                '&:hover': {
                                  opacity: 0.8,
                                },
                              }}
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  )}

                </CardContent>

                {/* Footer with Expiration Days Chip and Action Buttons */}
                <Box sx={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 0.5, 
                  p: 1.5, 
                  borderTop: '1px solid', 
                  borderColor: 'divider',
                  backgroundColor: 'action.hover'
                }}>
                  {/* Expiration Days Chip */}
                  {(() => {
                    const expirationDate = provider.provider_details?.expiration_date;
                    if (expirationDate) {
                      const expirationTime = expirationDate * 1000;
                      const now = Date.now();
                      const daysLeft = Math.ceil((expirationTime - now) / (1000 * 60 * 60 * 24));
                      const isWarning = daysLeft <= 30;
                      
                      return (
                        <Chip
                          label={`${daysLeft}d`}
                          size="small"
                          color={isWarning ? 'warning' : 'default'}
                          sx={{
                            fontSize: '0.7rem',
                            height: '24px',
                          }}
                        />
                      );
                    }
                    return null;
                  })()}
                  
                  {/* Action Buttons */}
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <Tooltip title={provider.enabled ? 'Disable provider' : 'Enable provider'}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={provider.enabled !== false}
                            onChange={(e) => handleToggleEnabled(provider, e.target.checked)}
                            size="small"
                            color="primary"
                          />
                        }
                        label=""
                        sx={{ m: 0, mr: 0.5 }}
                      />
                    </Tooltip>
                    <Tooltip title="Edit Provider Details">
                      <IconButton
                        size="small"
                        onClick={() => handleEdit(provider)}
                        color="primary"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete Provider">
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(provider.id)}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Provider Editor Dialog */}
      <ProviderEditorDialog
        open={editorDialogOpen}
        provider={selectedProvider}
        onClose={handleCloseEditorDialog}
        onSave={handleSave}
        onSaveAndManageMediaTypes={handleSaveAndManageMediaTypes}
      />

      {/* Media Type Dialog */}
      {selectedProvider && selectedProvider.id && (
        <MediaTypeDialog
          open={mediaTypeDialogOpen}
          provider={selectedProvider}
          onClose={handleCloseMediaTypeDialog}
          onSave={handleMediaTypeDialogSave}
        />
      )}

    </Box>
  );
}

export default SettingsIPTVProviders;
