import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Snackbar,
  Alert,
  Tabs,
  Tab,
} from '@mui/material';
import {
  fetchIPTVProviders,
  saveIPTVProvider,
  deleteIPTVProvider,
  fetchIPTVProviderCategories,
  updateIPTVProviderPriorities
} from './iptv/utils';
import ProviderList from './iptv/ProviderList';
import ProviderDetailsForm from './iptv/ProviderDetailsForm';
import CleanupRulesForm from './iptv/CleanupRulesForm';
import ExcludedCategoriesForm from './iptv/ExcludedCategoriesForm';

function SettingsIPTVProviders() {
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [isNewProvider, setIsNewProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [activeTab, setActiveTab] = useState('details');
  const [categories, setCategories] = useState(null);
  const [loadingCategories, setLoadingCategories] = useState(false);

  const showSnackbar = useCallback((message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchIPTVProviders();
      setProviders(data);
    } catch (error) {
      console.error('Error fetching providers:', error);
      setError('Failed to load providers. Please try again later.');
      showSnackbar('Failed to load providers', 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  const loadCategories = useCallback(async (providerId) => {
    if (!providerId) return;

    try {
      setLoadingCategories(true);
      const data = await fetchIPTVProviderCategories(providerId);
      setCategories(data);
    } catch (error) {
      console.error('Error fetching categories:', error);
      showSnackbar('Failed to load categories', 'error');
    } finally {
      setLoadingCategories(false);
    }
  }, [showSnackbar]);

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
  };

  const handleAdd = () => {
    setSelectedProvider({
      type: 'xtream',
      enabled: true,
      priority: providers.length + 1,
      cleanup: {}
    });
    setIsNewProvider(true);
    setActiveTab('details');
  };

  const handleDelete = async (providerId) => {
    try {
      await deleteIPTVProvider(providerId);
      showSnackbar('Provider deleted successfully');
      if (selectedProvider?.id === providerId) {
        setSelectedProvider(null);
        setCategories(null);
      }
      loadProviders();
    } catch (error) {
      console.error('Error deleting provider:', error);
      showSnackbar('Failed to delete provider', 'error');
    }
  };

  const handleSave = async (providerData) => {
    try {
      const savedProvider = await saveIPTVProvider(providerData);
      showSnackbar(isNewProvider ? 'Provider added successfully' : 'Provider updated successfully');

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

      // Reload categories if needed
      if (savedProvider.type?.toLowerCase() === 'xtream') {
        loadCategories(savedProvider.id);
      }
    } catch (error) {
      console.error('Error saving provider:', error);
      showSnackbar('Failed to save provider', 'error');
    }
  };

  const handleCloseDialog = () => {
    setSelectedProvider(null);
    setIsNewProvider(false);
    setActiveTab('details');
    setCategories(null);
  };

  const handleDragEnd = useCallback(async (result) => {
    if (!result.destination) return;

    const items = Array.from(providers);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update priorities based on new order
    const updatedProviders = items.map((provider, index) => ({
      ...provider,
      priority: index + 1
    }));

    setProviders(updatedProviders);

    try {
      await updateIPTVProviderPriorities({ providers: updatedProviders });
    } catch (error) {
      console.error('Error updating provider priorities:', error);
      showSnackbar('Failed to update provider priorities', 'error');
      // Revert to original order on error
      loadProviders();
    }
  }, [providers, showSnackbar, loadProviders]);

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
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" gap={2} sx={{ flex: 1, overflow: 'hidden' }}>
        {/* Provider List */}
        <Box flex={1} maxWidth={300} sx={{ overflowY: 'auto' }}>
          <ProviderList
            providers={providers}
            selectedProvider={selectedProvider}
            isNewProvider={isNewProvider}
            onEdit={handleEdit}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onDragEnd={handleDragEnd}
            onCloseDialog={handleCloseDialog}
            error={error}
          />
        </Box>

        {/* Main Content */}
        <Box flex={3} sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs Header - Only show when a provider is selected */}
          {selectedProvider && (
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                TabIndicatorProps={{
                  sx: { backgroundColor: 'primary.main' }
                }}
              >
                {renderTabs()}
              </Tabs>
            </Box>
          )}

          {/* Scrollable Content Area */}
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            <Box sx={{ p: 2, pb: 0 }}>
              <Card>
                <CardContent>
                  {renderTabContent()}
                </CardContent>
              </Card>
              <Box sx={{ height: 80 }} />
            </Box>
          </Box>
        </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default SettingsIPTVProviders;
