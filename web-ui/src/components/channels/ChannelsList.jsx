import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useAuth } from '../../context/AuthContext';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  CircularProgress,
  Grid,
  useTheme,
  useMediaQuery,
  IconButton,
  Tooltip,
  CardActions,
  TextField,
  InputAdornment,
  ToggleButtonGroup,
  ToggleButton,
  Drawer,
  Divider,
  Badge,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel,
  FormGroup
} from '@mui/material';
import {
  PlaylistAdd,
  PlaylistAddCheck,
  Search as SearchIcon,
  FilterList,
  OpenInNew as OpenInNewIcon,
  ContentCopy as ContentCopyIcon,
  ErrorOutline,
  ChevronLeft,
  Close,
  Clear
} from '@mui/icons-material';
import { debounce } from 'lodash';
import {
  fetchChannels,
  updateFilters,
  clearFilters,
  incrementPage,
  addChannelToWatchlist,
  removeChannelFromWatchlist,
  fetchCategories
} from '../../store/slices/channelsSlice';
import { fetchProviders } from '../../store/slices/providerSlice';
import { API_URL } from '../../config';
import { authService } from '../../services/auth';

// Base64 encoded placeholder image (1x1 transparent pixel)
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Utility function to sanitize image URLs
const sanitizeImageUrl = (url) => {
  if (!url) return PLACEHOLDER_IMAGE;
  const cleanUrl = url.split('https://').pop();
  return cleanUrl ? `https://${cleanUrl}` : PLACEHOLDER_IMAGE;
};

/**
 * ChannelsList component for displaying Live TV channels in a grid
 */
const ChannelsList = () => {
  const theme = useTheme();
  const { isAuthenticated, user } = useAuth();
  const dispatch = useDispatch();
  const { channels, loading, error, filters, pagination, categories, categoriesLoading } = useSelector(state => state.channels);
  const { providers } = useSelector(state => state.providers);
  const [apiKey, setApiKey] = useState(null);
  const [copiedChannelKey, setCopiedChannelKey] = useState(null);
  const [loadingItems, setLoadingItems] = useState(new Set());
  const [categorySearchQuery, setCategorySearchQuery] = useState('');

  // Define breakpoints for different screen sizes
  const isXSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const isSmall = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  
  // Sidebar state with localStorage persistence
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('channelsSidebarOpen');
    return saved !== null ? JSON.parse(saved) : !isXSmall;
  });

  // Persist sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('channelsSidebarOpen', JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  // IntersectionObserver for infinite scroll
  const observer = useRef();
  const lastChannelElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && pagination.page < pagination.total_pages) {
        dispatch(incrementPage());
        dispatch(fetchChannels());
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, pagination.page, pagination.total_pages, dispatch]);

  // Create memoized debounced functions
  const debouncedUpdateFilters = useMemo(
    () => debounce((updates) => {
      dispatch(updateFilters(updates));
    }, 500),
    [dispatch]
  );

  // Cleanup debounced functions on unmount
  useEffect(() => {
    return () => {
      debouncedUpdateFilters.cancel();
    };
  }, [debouncedUpdateFilters]);

  // Fetch providers on mount
  useEffect(() => {
    const providersArray = Array.isArray(providers) ? providers : [];
    if (providersArray.length === 0) {
      dispatch(fetchProviders());
    }
  }, [dispatch, providers]);

  // Fetch categories on mount
  useEffect(() => {
    if (isAuthenticated && user) {
      dispatch(fetchCategories());
    }
  }, [dispatch, isAuthenticated, user]);

  // Initial fetch
  useEffect(() => {
    if (isAuthenticated && user) {
      dispatch(fetchChannels());
    }
  }, [dispatch, isAuthenticated, user, filters]);

  // Load API key when component mounts
  useEffect(() => {
    if (isAuthenticated && user) {
      const loadApiKey = async () => {
        if (user?.api_key) {
          setApiKey(user.api_key);
        } else {
          try {
            const profile = await authService.getProfile();
            setApiKey(profile.api_key);
          } catch (error) {
            console.error('Failed to load API key:', error);
          }
        }
      };
      loadApiKey();
    }
  }, [isAuthenticated, user]);

  // Handle search change
  const handleSearchChange = useCallback((event) => {
    const value = event.target.value;
    dispatch(updateFilters({ searchQuery: value }));
  }, [dispatch]);

  // Handle watchlist filter change
  const handleWatchlistFilterChange = (event, newFilter) => {
    if (newFilter !== null) {
      dispatch(updateFilters({ watchlistFilter: newFilter }));
    }
  };

  // Handle provider filter change
  const handleProviderFilterChange = (event) => {
    dispatch(updateFilters({ providerId: event.target.value }));
  };

  // Handle category filter change
  const handleCategoryChange = (categoryName) => {
    const currentCategories = filters.categories || [];
    const newCategories = currentCategories.includes(categoryName)
      ? currentCategories.filter(cat => cat !== categoryName)
      : [...currentCategories, categoryName];
    dispatch(updateFilters({ categories: newCategories }));
  };

  // Handle clear all filters
  const handleClearFilters = () => {
    dispatch(clearFilters());
    dispatch(fetchChannels());
  };

  // Get stream URL for a channel
  const getStreamUrl = (channelKey) => {
    if (!apiKey) return null;
    
    // Check if API_URL is already a full URL (starts with http:// or https://)
    let apiBase;
    if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
      // API_URL is already a full URL, use it directly
      apiBase = API_URL.replace(/\/$/, ''); // Remove trailing slash if present
    } else {
      // API_URL is a relative path, combine with window.location.origin
      const baseUrl = window.location.origin;
      const apiPath = API_URL.replace(/\/$/, ''); // Remove trailing slash if present
      apiBase = `${baseUrl}${apiPath}`;
    }
    
    const encodedChannelKey = encodeURIComponent(channelKey);
    return `${apiBase}/livetv/stream/${encodedChannelKey}?api_key=${apiKey}`;
  };

  // Handle opening stream in new tab
  const handleOpenInNewTab = (channelKey) => {
    const streamUrl = getStreamUrl(channelKey);
    if (streamUrl) {
      window.open(streamUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Handle copying stream URL to clipboard
  const handleCopyUrl = async (channelKey) => {
    const streamUrl = getStreamUrl(channelKey);
    if (streamUrl) {
      try {
        await navigator.clipboard.writeText(streamUrl);
        setCopiedChannelKey(channelKey);
        setTimeout(() => setCopiedChannelKey(null), 2000);
      } catch (error) {
        console.error('Failed to copy URL:', error);
      }
    }
  };

  // Handle watchlist toggle
  const toggleWatchlist = useCallback(async (channelKey, currentState) => {
    try {
      setLoadingItems(prev => new Set([...prev, channelKey]));
      if (currentState) {
        await dispatch(removeChannelFromWatchlist(channelKey)).unwrap();
      } else {
        await dispatch(addChannelToWatchlist(channelKey)).unwrap();
      }
    } catch (error) {
      console.error('Failed to update watchlist:', error);
    } finally {
      setLoadingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(channelKey);
        return newSet;
      });
    }
  }, [dispatch]);

  // Calculate active filter count for badge
  const getActiveFilterCount = useCallback(() => {
    let count = 0;
    if (filters.watchlistFilter && filters.watchlistFilter !== 'all') count++;
    if (filters.providerId) count++;
    if (filters.searchQuery) count++;
    if (filters.categories && filters.categories.length > 0) count++;
    return count;
  }, [filters]);

  const activeFilterCount = getActiveFilterCount();

  const renderErrorMessage = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main', p: 3 }}>
      <ErrorOutline />
      <Typography>{error}</Typography>
    </Box>
  );

  const drawerWidth = 320;
  const isMobile = isXSmall || isSmall;

  // Filter enabled providers for dropdown
  const enabledProviders = Array.isArray(providers) 
    ? providers.filter(p => p.enabled && !p.deleted)
    : [];

  if (!isAuthenticated || !user) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Please log in to view channels.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', position: 'relative' }}>
      {/* Filter Sidebar Drawer */}
      <Drawer
        variant={isMobile ? 'temporary' : 'persistent'}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        anchor="left"
        ModalProps={{
          sx: {
            zIndex: (theme) => theme.zIndex.drawer + 10,
          },
        }}
        sx={{
          ...(isMobile ? {} : {
            width: sidebarOpen ? drawerWidth : 0,
            flexShrink: 0,
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          }),
          '& .MuiDrawer-paper': {
            width: isMobile ? '100vw' : drawerWidth,
            height: isMobile ? '100vh' : 'auto',
            boxSizing: 'border-box',
            position: isMobile ? 'fixed' : 'relative',
            top: isMobile ? 0 : 'auto',
            left: isMobile ? 0 : 'auto',
            zIndex: isMobile ? (theme) => theme.zIndex.drawer + 2 : 'auto',
            borderRight: isMobile ? 'none' : '1px solid',
            borderColor: 'divider',
            transition: theme.transitions.create(['width', 'height'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          },
        }}
      >
        <Box sx={{ 
          p: 2, 
          overflowY: 'auto', 
          height: isMobile ? '100%' : 'auto',
          maxHeight: isMobile ? '100vh' : 'calc(100vh - 64px)',
          backgroundColor: 'background.paper'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
              Filters
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {!isMobile && (
                <Tooltip title="Clear all filters">
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleClearFilters}
                      aria-label="clear filters"
                      disabled={activeFilterCount === 0}
                      sx={{ 
                        color: 'text.secondary',
                        '&:hover': {
                          backgroundColor: 'action.hover'
                        },
                        '&:disabled': {
                          opacity: 0.3
                        }
                      }}
                    >
                      <Clear />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <IconButton
                size="small"
                onClick={() => setSidebarOpen(false)}
                aria-label="close sidebar"
                sx={{ 
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: 'action.hover'
                  }
                }}
              >
                {isMobile ? <Close /> : <ChevronLeft />}
              </IconButton>
            </Box>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Watchlist Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Watchlist
            </Typography>
            <ToggleButtonGroup
              value={filters.watchlistFilter}
              exclusive
              onChange={handleWatchlistFilterChange}
              aria-label="watchlist filter"
              fullWidth
              size="small"
            >
              <ToggleButton value="all" aria-label="all channels">
                <Tooltip title="All Channels">
                  <FilterList />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="checked" aria-label="in watchlist" sx={{
                '&.Mui-selected': {
                  backgroundColor: 'success.main',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'success.dark',
                  }
                }
              }}>
                <Tooltip title="In Watchlist">
                  <PlaylistAddCheck />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="unchecked" aria-label="not in watchlist">
                <Tooltip title="Not in Watchlist">
                  <PlaylistAdd />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Provider Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Provider
            </Typography>
            <FormControl fullWidth size="small">
              <InputLabel id="provider-filter-label">All Providers</InputLabel>
              <Select
                labelId="provider-filter-label"
                value={filters.providerId || ''}
                onChange={handleProviderFilterChange}
                label="All Providers"
              >
                <MenuItem value="">All Providers</MenuItem>
                {enabledProviders.map(provider => (
                  <MenuItem key={provider.id} value={provider.id}>
                    {provider.name || provider.id}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Category Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Category
            </Typography>
            {categoriesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : categories.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No categories available. Make sure channels are synced and have group titles.
              </Typography>
            ) : (
              <>
                {/* Category Search */}
                {categories.length > 5 && (
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search categories..."
                    value={categorySearchQuery}
                    onChange={(e) => setCategorySearchQuery(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mb: 1.5 }}
                  />
                )}
                <FormGroup>
                  <Box sx={{ 
                    maxHeight: '300px', 
                    overflowY: 'auto',
                    pr: 1
                  }}>
                    {categories
                      .filter(category => 
                        !categorySearchQuery || 
                        category.toLowerCase().includes(categorySearchQuery.toLowerCase())
                      )
                      .map((category) => (
                        <FormControlLabel
                          key={category}
                          control={
                            <Checkbox
                              checked={(filters.categories || []).includes(category)}
                              onChange={() => handleCategoryChange(category)}
                              size="small"
                            />
                          }
                          label={
                            <Typography variant="body2" noWrap>
                              {category}
                            </Typography>
                          }
                          sx={{ mb: 0.5 }}
                        />
                      ))}
                    {categories.filter(category => 
                      !categorySearchQuery || 
                      category.toLowerCase().includes(categorySearchQuery.toLowerCase())
                    ).length === 0 && categorySearchQuery && (
                      <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                        No categories match "{categorySearchQuery}"
                      </Typography>
                    )}
                  </Box>
                </FormGroup>
              </>
            )}
          </Box>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 3 }}>
          {/* Search, Toggle Button, and Title Count */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Search channels..."
              value={filters.searchQuery || ''}
              onChange={handleSearchChange}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ flexGrow: 1 }}
            />

            <Badge badgeContent={activeFilterCount} color="primary" invisible={activeFilterCount === 0}>
              <Tooltip title={sidebarOpen ? 'Hide filters' : 'Show filters'}>
                <IconButton
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  aria-label="toggle filters"
                  color={sidebarOpen ? 'primary' : 'default'}
                  sx={{
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.1)'
                    }
                  }}
                >
                  <FilterList />
                </IconButton>
              </Tooltip>
            </Badge>

            {/* Total Count Display */}
            {!error && pagination?.total !== undefined && (
              <Typography 
                variant="body2" 
                color="text.secondary"
                sx={{ 
                  whiteSpace: 'nowrap',
                  display: { xs: 'none', sm: 'block' } // Hide on mobile to save space
                }}
              >
                {pagination.total === 0 
                  ? 'No channels available' 
                  : `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'channel' : 'channels'} found`}
              </Typography>
            )}
          </Box>

          {/* Total Count Display - Mobile */}
          {!error && pagination?.total !== undefined && (
            <Typography 
              variant="body2" 
              color="text.secondary" 
              sx={{ 
                mb: 2,
                display: { xs: 'block', sm: 'none' } // Show only on mobile
              }}
            >
              {pagination.total === 0 
                ? 'No channels available' 
                : `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'channel' : 'channels'} found`}
            </Typography>
          )}

          {/* Error Message */}
          {error && renderErrorMessage()}
        </Box>

        {/* Channels Grid */}
        {channels.length === 0 && !loading ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="h6" gutterBottom>
              No Live TV Channels
            </Typography>
            <Typography color="text.secondary">
              Configure your Live TV providers in settings to start viewing channels.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {channels.map((channel, index) => {
              const streamUrl = getStreamUrl(channel.channel_key);
              const isCopied = copiedChannelKey === channel.channel_key;
              const isInWatchlist = channel.watchlist || false;
              const isLoading = loadingItems.has(channel.channel_key);
              
              // Add ref to last element for infinite scroll
              const isLastElement = index === channels.length - 1;
              
              return (
                <Grid 
                  item 
                  xs={12} 
                  sm={6} 
                  md={4} 
                  lg={3} 
                  xl={2} 
                  key={channel.channel_key || channel.channel_id}
                  ref={isLastElement ? lastChannelElementRef : null}
                >
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: theme.shadows[8]
                      }
                    }}
                  >
                    {channel.tvg_logo && (
                      <CardMedia
                        component="img"
                        height="140"
                        image={sanitizeImageUrl(channel.tvg_logo)}
                        alt={channel.name}
                        sx={{
                          objectFit: 'contain',
                          bgcolor: 'background.paper',
                          p: 1
                        }}
                        onError={(e) => {
                          e.target.src = PLACEHOLDER_IMAGE;
                        }}
                      />
                    )}
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography
                        variant="h6"
                        component="div"
                        gutterBottom
                        noWrap={!isMobile}
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: isMobile ? '-webkit-box' : 'block',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: isMobile ? 2 : 'unset',
                          whiteSpace: isMobile ? 'normal' : 'nowrap'
                        }}
                      >
                        {channel.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        ID: {channel.channel_id}
                      </Typography>
                      {channel.currentProgram && (
                        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                          <Typography variant="caption" color="text.secondary" display="block">
                            Now Playing:
                          </Typography>
                          <Typography variant="body2" component="div" sx={{ fontWeight: 'medium' }}>
                            {channel.currentProgram.title}
                          </Typography>
                          {channel.currentProgram.desc && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                              {channel.currentProgram.desc.length > 100
                                ? `${channel.currentProgram.desc.substring(0, 100)}...`
                                : channel.currentProgram.desc}
                            </Typography>
                          )}
                        </Box>
                      )}
                      {channel.group_title && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                          {channel.group_title}
                        </Typography>
                      )}
                    </CardContent>
                    <CardActions sx={{ justifyContent: 'space-between', pt: 0, px: 1, pb: 1 }}>
                      <Tooltip title={isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatchlist(channel.channel_key, isInWatchlist);
                          }}
                          disabled={isLoading}
                          color={isInWatchlist ? 'success' : 'default'}
                        >
                          {isLoading ? (
                            <CircularProgress size={16} />
                          ) : isInWatchlist ? (
                            <PlaylistAddCheck fontSize="small" />
                          ) : (
                            <PlaylistAdd fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Box>
                        <Tooltip title={isCopied ? 'URL Copied!' : 'Copy Stream URL'}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyUrl(channel.channel_key);
                            }}
                            disabled={!streamUrl}
                            color={isCopied ? 'success' : 'default'}
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Open Stream in New Tab">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenInNewTab(channel.channel_key);
                            }}
                            disabled={!streamUrl}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </CardActions>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}

        {/* Loading Indicator */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ChannelsList;
