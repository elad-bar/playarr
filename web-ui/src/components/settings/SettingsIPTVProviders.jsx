import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  Button,
} from '@mui/material';
import {
  fetchIPTVProviders,
  deleteIPTVProvider,
  getProviderTypeColor,
} from './iptv/utils';
import ProviderWizard from './iptv/ProviderWizard';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

function SettingsIPTVProviders() {
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [isNewProvider, setIsNewProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0); // Force complete remount on each open

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

  const handleEdit = (provider) => {
    setSelectedProvider(provider);
    setIsNewProvider(false);
    setWizardKey(prev => prev + 1); // Force remount
    setDialogOpen(true);
  };

  const handleAdd = (providerType = null) => {
    setSelectedProvider(providerType ? { type: providerType } : null);
    setIsNewProvider(true);
    setWizardKey(prev => prev + 1); // Force remount
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    // Don't reset provider/key immediately - let Dialog close animation complete
    setTimeout(() => {
      setSelectedProvider(null);
      setIsNewProvider(false);
    }, 100);
  };

  const handleDelete = async (providerId) => {
    try {
      await deleteIPTVProvider(providerId);
      setSuccess('Provider deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
      if (selectedProvider?.id === providerId) {
        handleCloseDialog();
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
    } catch (error) {
      console.error('Error saving provider:', error);
      setError('Failed to save provider');
    }
  };

  const handleSaveAndClose = async (savedProvider) => {
    try {
      setSuccess(isNewProvider ? 'Provider added successfully' : 'Provider updated successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Reload providers to get fresh data (this will also sort them)
      loadProviders();

      // Close dialog
      handleCloseDialog();
    } catch (error) {
      console.error('Error saving provider:', error);
      setError('Failed to save provider');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
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
            <Grid item xs={12} sm={6} md={4} lg={3} key={provider.id}>
              <Card sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                borderBottom: `2px ${provider.enabled ? 'solid' : 'dashed'} ${getProviderTypeColor(provider.type)}`
              }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  {/* Title with Provider ID */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontFamily: 'monospace', flex: 1 }}>
                      {provider.id}
                    </Typography>
                  </Box>

                  {/* Provider Details */}
                  {provider.provider_details && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>Maximum Connections:</strong> {provider.provider_details.max_connections ?? 'N/A'}
                      </Typography>
                      {provider.type?.toLowerCase() === 'xtream' && (
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          <strong>Active Connections:</strong> {provider.provider_details.active_connections ?? 'N/A'}
                        </Typography>
                      )}
                      <Typography variant="body2">
                        <strong>Expiration Date:</strong> {
                          provider.provider_details.expiration_date 
                            ? new Date(provider.provider_details.expiration_date * 1000).toLocaleDateString()
                            : 'N/A'
                        }
                      </Typography>
                    </Box>
                  )}

                  {/* Action Buttons */}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                    <IconButton
                      size="small"
                      onClick={() => handleEdit(provider)}
                      color="primary"
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(provider.id)}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Provider Form Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="lg"
        fullWidth
        fullScreen
        TransitionProps={{ timeout: 0 }}
        sx={{
          // Disable all transitions to prevent ResizeObserver loops
          '& .MuiDialog-container': {
            transition: 'none !important',
          },
          '& .MuiDialog-paper': {
            transition: 'none !important',
            animation: 'none !important',
          },
        }}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          pb: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}>
          <Typography variant="h5" component="span" fontWeight={600}>
            {isNewProvider ? 'Add New Provider' : `Edit Provider: ${selectedProvider?.id}`}
          </Typography>
          <Tooltip title="Close">
            <IconButton
              onClick={handleCloseDialog}
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
          {dialogOpen && (
            <ProviderWizard
              key={`wizard-${wizardKey}-${selectedProvider?.id || 'new'}`}
              provider={selectedProvider}
              onSave={handleSave}
              onCancel={handleCloseDialog}
              onSaveAndClose={handleSaveAndClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default SettingsIPTVProviders;
