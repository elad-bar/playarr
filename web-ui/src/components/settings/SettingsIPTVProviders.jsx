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
  Tabs,
  Tab,
} from '@mui/material';
import {
  fetchIPTVProviders,
  saveIPTVProvider,
  deleteIPTVProvider,
  fetchIPTVProviderCategories
} from './iptv/utils';
import ProviderDetailsForm from './iptv/ProviderDetailsForm';
import CleanupRulesForm from './iptv/CleanupRulesForm';
import ExcludedCategoriesForm from './iptv/ExcludedCategoriesForm';
import IgnoredTitlesForm from './iptv/IgnoredTitlesForm';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
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
  const [activeTab, setActiveTab] = useState('details');
  const [categories, setCategories] = useState(null);
  const [loadingCategories, setLoadingCategories] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchIPTVProviders();
      setProviders(data);
    } catch (error) {
      console.error('Error fetching providers:', error);
      setError('Failed to load providers. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async (providerId) => {
    if (!providerId) return;

    try {
      setLoadingCategories(true);
      const data = await fetchIPTVProviderCategories(providerId);
      setCategories(data);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to load categories');
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    // Load categories when a non-new Xtream provider is selected
    if (selectedProvider?.id && !isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
      loadCategories(selectedProvider.id);
    } else {
      setCategories(null);
    }
  }, [selectedProvider?.id, isNewProvider, selectedProvider?.type, loadCategories]);

  const handleEdit = (provider) => {
    setSelectedProvider(provider);
    setIsNewProvider(false);
    setActiveTab('details');
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setSelectedProvider({
      type: 'xtream',
      enabled: true,
      cleanup: {}
    });
    setIsNewProvider(true);
    setActiveTab('details');
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedProvider(null);
    setIsNewProvider(false);
    setActiveTab('details');
    setCategories(null);
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

  const handleSave = async (providerData) => {
    try {
      const savedProvider = await saveIPTVProvider(providerData, isNewProvider);
      setSuccess(isNewProvider ? 'Provider added successfully' : 'Provider updated successfully');
      setTimeout(() => setSuccess(null), 3000);

      // Update local state instead of making another API call
      if (isNewProvider) {
        setProviders(prevProviders => [...prevProviders, savedProvider]);
      } else {
        setProviders(prevProviders =>
          prevProviders.map(p => p.id === savedProvider.id ? savedProvider : p)
        );
      }

      setSelectedProvider(savedProvider);
      setIsNewProvider(false);
      handleCloseDialog();

      // Reload providers to get fresh data
      loadProviders();
    } catch (error) {
      console.error('Error saving provider:', error);
      setError('Failed to save provider');
    }
  };

  const handleSaveFromHeader = () => {
    // Trigger save based on active tab
    switch (activeTab) {
      case 'details':
        if (ProviderDetailsForm.saveHandler) {
          ProviderDetailsForm.saveHandler();
        }
        break;
      case 'cleanup':
        if (CleanupRulesForm.saveHandler) {
          CleanupRulesForm.saveHandler();
        }
        break;
      case 'movies':
      case 'tvshows':
        // ExcludedCategoriesForm - changes are auto-saved, so just close
        handleCloseDialog();
        break;
      case 'ignored':
        // IgnoredTitlesForm is read-only, so just close
        handleCloseDialog();
        break;
      default:
        handleCloseDialog();
    }
  };

  // Removed handleDragEnd - priority support removed

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const renderTabs = () => {
    const tabs = [
      <Tab
        key="details"
        value="details"
        label="Details"
        sx={{
          '&.Mui-selected': {
            color: 'primary.main',
          }
        }}
      />
    ];

    if (!isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
      tabs.push(
        <Tab
          key="cleanup"
          value="cleanup"
          label="Cleanup Rules"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />,
        <Tab
          key="movies"
          value="movies"
          label="Movies"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />,
        <Tab
          key="tvshows"
          value="tvshows"
          label="TV Shows"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />
      );
    }

    // Ignored Titles tab available for all providers (not just Xtream)
    if (!isNewProvider) {
      tabs.push(
        <Tab
          key="ignored"
          value="ignored"
          label="Ignored Titles"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />
      );
    }

    return tabs;
  };

  const renderTabContent = () => {
    if (!selectedProvider) {
      return (
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            IPTV Provider Management
          </Typography>
          <Typography color="textSecondary">
            Select a provider from the list or add a new one to manage IPTV configurations.
          </Typography>
        </Box>
      );
    }

    switch (activeTab) {
      case 'details':
        return (
          <ProviderDetailsForm
            provider={selectedProvider}
            onSave={handleSave}
            onCancel={handleCloseDialog}
          />
        );
      case 'cleanup':
        if (!isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
          return (
            <CleanupRulesForm
              provider={selectedProvider}
              onSave={handleSave}
              onCancel={handleCloseDialog}
            />
          );
        }
        return null;
      case 'movies':
        if (!isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
          return (
            <ExcludedCategoriesForm
              provider={selectedProvider}
              categoryType="movies"
              categories={categories}
              loading={loadingCategories}
              onCategoryUpdate={loadCategories}
            />
          );
        }
        return null;
      case 'tvshows':
        if (!isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
          return (
            <ExcludedCategoriesForm
              provider={selectedProvider}
              categoryType="tvshows"
              categories={categories}
              loading={loadingCategories}
              onCategoryUpdate={loadCategories}
            />
          );
        }
        return null;
      case 'ignored':
        if (!isNewProvider) {
          return (
            <IgnoredTitlesForm
              provider={selectedProvider}
            />
          );
        }
        return null;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
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
        <Typography variant="h6" sx={{ mb: 3 }}>IPTV Provider Management</Typography>

        <Grid container spacing={3}>
          {/* Add New Provider Card */}
          <Grid item xs={12} sm={6} md={4} lg={3}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                border: '2px dashed',
                borderColor: 'divider',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'action.hover'
                }
              }}
              onClick={handleAdd}
            >
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <AddIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                <Typography variant="h6" color="text.secondary">
                  Add New Provider
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Provider Cards */}
          {providers.map((provider) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={provider.id}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  {/* Title with Provider ID and Chips */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontFamily: 'monospace', flex: 1 }}>
                      {provider.id}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          bgcolor: 'primary.light',
                          color: 'primary.contrastText',
                          textTransform: 'capitalize'
                        }}
                      >
                        {provider.type || 'Unknown'}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          bgcolor: provider.enabled ? 'success.light' : 'error.light',
                          color: provider.enabled ? 'success.contrastText' : 'error.contrastText'
                        }}
                      >
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </Typography>
                    </Box>
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
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" component="span">
            {isNewProvider ? 'Add New Provider' : `Edit Provider: ${selectedProvider?.id}`}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {(activeTab === 'details' || activeTab === 'cleanup') && (
              <Tooltip title="Save Changes">
                <IconButton
                  onClick={handleSaveFromHeader}
                  color="primary"
                  size="small"
                >
                  <SaveIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Close">
              <IconButton
                onClick={handleCloseDialog}
                size="small"
              >
                <CloseIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </DialogTitle>
        <DialogContent>
          {/* Tabs Header */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
            >
              {renderTabs()}
            </Tabs>
          </Box>

          {/* Tab Content */}
          <Box sx={{ mt: 2 }}>
            {renderTabContent()}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default SettingsIPTVProviders;
