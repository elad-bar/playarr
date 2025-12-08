import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { Box, Typography, Card, CardContent, CardMedia, CircularProgress, TextField, InputAdornment, Tooltip, ToggleButtonGroup, ToggleButton, useTheme, useMediaQuery, Chip, Drawer, Divider, Badge, IconButton, FormControl, Select, MenuItem, Checkbox, ListItemText } from '@mui/material';
import { SearchOutlined as SearchIcon, FilterListOutlined as FilterList, MovieOutlined as MovieIcon, LiveTvOutlined as LiveTvIcon, ErrorOutline, ChevronLeftOutlined as ChevronLeft, CloseOutlined as Close, ClearOutlined as Clear, WarningOutlined as WarningIcon } from '@mui/icons-material';
import { debounce } from 'lodash';
import { ignoredTitlesService } from '../../../services/ignoredTitles';
import { fetchIPTVProviders } from '../../settings/iptv/utils';
import FixTitleDialog from './FixTitleDialog';

const MEDIA_TYPE_OPTIONS = [
  { value: '', label: 'All', icon: <FilterList /> },
  { value: 'movies', label: 'Movies', icon: <MovieIcon /> },
  { value: 'tvshows', label: 'TV Shows', icon: <LiveTvIcon /> }
];

const IgnoredTitlesList = ({ searchQuery = '', onSearchChange }) => {
  const theme = useTheme();
  const [titles, setTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, perPage: 50, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({
    mediaType: '',
    issueType: '',
    providerId: [],
    search: ''
  });
  const [providers, setProviders] = useState([]);
  const [issueTypes, setIssueTypes] = useState([]);
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Define breakpoints for different screen sizes
  const isXSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const isSmall = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const isMedium = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const isLarge = useMediaQuery(theme.breakpoints.between('lg', 'xl'));
  const isXLarge = useMediaQuery(theme.breakpoints.up('xl'));

  // Calculate grid columns
  const getGridColumns = () => {
    if (isXSmall) return 1;
    if (isSmall) return 2;
    if (isMedium) return 3;
    if (isLarge) return 4;
    if (isXLarge) return 5;
    return 4;
  };

  // Sidebar state with localStorage persistence
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('ignoredTitlesSidebarOpen');
    return saved !== null ? JSON.parse(saved) : !isXSmall;
  });

  // Persist sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('ignoredTitlesSidebarOpen', JSON.stringify(sidebarOpen));
  }, [sidebarOpen]);

  // Load providers and issue types
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const providersList = await fetchIPTVProviders();
        setProviders(providersList);
      } catch (error) {
        console.error('Error loading providers:', error);
      }
    };
    loadProviders();
  }, []);

  // Load titles function
  const loadTitles = useCallback(async (page = 1, append = false, customFilters = null, customSearch = null) => {
    try {
      setLoading(true);
      setError(null);
      
      // Use custom filters/search if provided, otherwise use current state
      const filtersToUse = customFilters !== null ? customFilters : filters;
      const searchToUse = customSearch !== null ? customSearch : (searchQuery || filtersToUse.search);
      
      // Build filter object, only including non-empty values
      const filterParams = {
        page,
        per_page: pagination.perPage
      };
      
      if (filtersToUse.mediaType) {
        filterParams.media_type = filtersToUse.mediaType;
      }
      if (filtersToUse.issueType) {
        filterParams.issue_type = filtersToUse.issueType;
      }
      if (filtersToUse.providerId && filtersToUse.providerId.length > 0) {
        filterParams.provider_id = filtersToUse.providerId;
      }
      if (searchToUse) {
        filterParams.search = searchToUse;
      }
      
      const result = await ignoredTitlesService.fetchIgnoredTitles(filterParams);

      // Extract unique issue types from results
      if (!append && result.items) {
        const uniqueIssueTypes = [...new Set(result.items.map(item => item.ignored_reason).filter(Boolean))];
        setIssueTypes(uniqueIssueTypes);
      }

      if (append) {
        setTitles(prev => [...prev, ...result.items]);
      } else {
        setTitles(result.items || []);
      }

      setPagination({
        page: result.page,
        perPage: result.perPage,
        total: result.total,
        totalPages: result.totalPages
      });
    } catch (err) {
      console.error('Error fetching ignored titles:', err);
      setError('Failed to load ignored titles');
      if (!append) {
        setTitles([]);
      }
    } finally {
      setLoading(false);
    }
  }, [filters, searchQuery, pagination.perPage]);

  const loadMoreTitles = useCallback(() => {
    if (pagination.page < pagination.totalPages && !loading) {
      loadTitles(pagination.page + 1, true);
    }
  }, [pagination, loading, loadTitles]);

  const observer = useRef();
  const lastTitleElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && pagination.page < pagination.totalPages) {
        loadMoreTitles();
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, pagination.page, pagination.totalPages, loadMoreTitles]);

  // Initial fetch and when filters change - reset to page 1
  useEffect(() => {
    let cancelled = false;
    
    const fetchData = async () => {
      // Reset pagination when filters change
      setPagination(prev => ({ ...prev, page: 1 }));
      
      try {
        setLoading(true);
        setError(null);
        
        // Build filter object, only including non-empty values
        const filterParams = {
          page: 1,
          per_page: pagination.perPage
        };
        
        if (filters.mediaType) {
          filterParams.media_type = filters.mediaType;
        }
        if (filters.issueType) {
          filterParams.issue_type = filters.issueType;
        }
        if (filters.providerId && filters.providerId.length > 0) {
          filterParams.provider_id = filters.providerId;
        }
        const searchValue = searchQuery || filters.search;
        if (searchValue) {
          filterParams.search = searchValue;
        }
        
        const result = await ignoredTitlesService.fetchIgnoredTitles(filterParams);
        
        if (cancelled) return;
        
        // Extract unique issue types from results
        if (result.items) {
          const uniqueIssueTypes = [...new Set(result.items.map(item => item.ignored_reason).filter(Boolean))];
          setIssueTypes(uniqueIssueTypes);
        }
        
        setTitles(result.items || []);
        setPagination({
          page: result.page,
          perPage: result.perPage,
          total: result.total,
          totalPages: result.totalPages
        });
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching ignored titles:', err);
        setError('Failed to load ignored titles');
        setTitles([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    fetchData();
    
    return () => {
      cancelled = true;
    };
  }, [filters, searchQuery, pagination.perPage]);

  // Debounced search
  const debouncedUpdateFilters = useMemo(
    () => debounce((updates) => {
      setFilters(prev => ({ ...prev, ...updates }));
    }, 500),
    []
  );

  useEffect(() => {
    return () => {
      debouncedUpdateFilters.cancel();
    };
  }, [debouncedUpdateFilters]);

  const handleLocalSearchChange = useCallback((event) => {
    const value = event.target.value;
    onSearchChange(event);
    debouncedUpdateFilters({ search: value });
  }, [onSearchChange, debouncedUpdateFilters]);

  const handleMediaTypeChange = (event, newValue) => {
    if (newValue !== null) {
      setFilters(prev => ({ ...prev, mediaType: newValue }));
    }
  };

  const handleIssueTypeChange = (event) => {
    setFilters(prev => ({ ...prev, issueType: event.target.value }));
  };

  const handleProviderChange = (event) => {
    const value = event.target.value;
    setFilters(prev => ({ ...prev, providerId: typeof value === 'string' ? value.split(',') : value }));
  };

  const handleClearFilters = () => {
    setFilters({
      mediaType: '',
      issueType: '',
      providerId: [],
      search: ''
    });
    if (onSearchChange) {
      const syntheticEvent = { target: { value: '' } };
      onSearchChange(syntheticEvent);
    }
  };

  const handleTitleClick = (title) => {
    setSelectedTitle(title);
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    setDialogOpen(false);
    setSelectedTitle(null);
  };

  const handleTitleFixed = () => {
    // Remove the fixed title from the list
    setTitles(prev => prev.filter(t => t._id !== selectedTitle._id));
    setPagination(prev => ({ ...prev, total: prev.total - 1 }));
    handleDialogClose();
  };

  const getActiveFilterCount = useCallback(() => {
    let count = 0;
    if (filters.mediaType) count++;
    if (filters.issueType) count++;
    if (filters.providerId && filters.providerId.length > 0) count++;
    if (filters.search) count++;
    return count;
  }, [filters]);

  const activeFilterCount = getActiveFilterCount();

  const renderErrorMessage = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
      <ErrorOutline />
      <Typography>{error}</Typography>
    </Box>
  );

  const drawerWidth = 320;
  const isMobile = isXSmall || isSmall;

  return (
    <Box sx={{ display: 'flex', position: 'relative', width: '100%' }}>
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

          {/* Media Type Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Media Type
            </Typography>
            <ToggleButtonGroup
              value={filters.mediaType}
              exclusive
              onChange={handleMediaTypeChange}
              aria-label="media type"
              fullWidth
              size="small"
            >
              {MEDIA_TYPE_OPTIONS.map(option => (
                <ToggleButton key={option.value} value={option.value} aria-label={option.label}>
                  <Tooltip title={option.label}>
                    {option.icon}
                  </Tooltip>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Issue Type Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Issue Type
            </Typography>
            <FormControl fullWidth size="small">
              <Select
                value={filters.issueType || ''}
                onChange={handleIssueTypeChange}
                displayEmpty
              >
                <MenuItem value="">All Issues</MenuItem>
                {issueTypes.map(issueType => (
                  <MenuItem key={issueType} value={issueType}>
                    {issueType}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {/* Provider Filter */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Provider
            </Typography>
            <FormControl fullWidth size="small">
              <Select
                multiple
                value={filters.providerId || []}
                onChange={handleProviderChange}
                renderValue={(selected) => selected.length === 0 ? 'All Providers' : `${selected.length} selected`}
              >
                {providers.map(provider => (
                  <MenuItem key={provider.id} value={provider.id}>
                    <Checkbox checked={filters.providerId?.indexOf(provider.id) > -1} />
                    <ListItemText primary={provider.name || provider.id} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Box>
      </Drawer>

      {/* Main Content Area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: sidebarOpen && !isMobile ? `calc(100% - ${drawerWidth}px)` : '100%',
          p: { xs: 2, sm: 3 },
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        <Box sx={{ mb: 3 }}>
          {/* Search, Toggle Button, and Title Count */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Search titles..."
              value={searchQuery}
              onChange={handleLocalSearchChange}
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
                  display: { xs: 'none', sm: 'block' }
                }}
              >
                {pagination.total === 0 
                  ? 'No ignored titles found' 
                  : `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'title' : 'titles'} found`}
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
                display: { xs: 'block', sm: 'none' }
              }}
            >
              {pagination.total === 0 
                ? 'No ignored titles found' 
                : `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'title' : 'titles'} found`}
            </Typography>
          )}

          {error && renderErrorMessage()}
        </Box>

        {/* Titles Grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
            gap: 2
          }}
        >
          {titles.map((item, index) => (
            <Card
              key={item._id}
              ref={index === titles.length - 1 ? lastTitleElementRef : null}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                cursor: 'pointer',
                position: 'relative',
                borderBottom: `2px solid ${item.type === 'tvshows' ? theme.palette.info.main : theme.palette.warning.main}`,
                '&:hover': {
                  transform: 'scale(1.02)',
                  transition: 'transform 0.2s'
                }
              }}
              onClick={() => handleTitleClick(item)}
            >
              <Box sx={{ position: 'relative' }}>
                {/* Type Icon */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    bgcolor: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: 1,
                    px: 1,
                    py: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    zIndex: 1
                  }}
                >
                  {item.type === 'tvshows' ? (
                    <LiveTvIcon sx={{ color: 'white', fontSize: '1.2rem' }} />
                  ) : (
                    <MovieIcon sx={{ color: 'white', fontSize: '1.2rem' }} />
                  )}
                </Box>

                {/* Provider Badge */}
                <Chip
                  label={item.provider_name}
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    zIndex: 1,
                    '& .MuiChip-label': {
                      px: 1,
                      fontSize: '0.75rem'
                    }
                  }}
                />

                {/* Placeholder Image */}
                <CardMedia
                  component="div"
                  sx={{
                    height: 300,
                    bgcolor: 'rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      color: 'text.secondary',
                      textAlign: 'center'
                    }}
                  >
                    {item.type === 'tvshows' ? (
                      <LiveTvIcon sx={{ fontSize: '4rem', opacity: 0.3 }} />
                    ) : (
                      <MovieIcon sx={{ fontSize: '4rem', opacity: 0.3 }} />
                    )}
                  </Box>
                </CardMedia>

                {/* Issue Type Badge */}
                <Chip
                  icon={<WarningIcon />}
                  label={item.ignored_reason}
                  size="small"
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    bgcolor: 'rgba(255, 152, 0, 0.9)',
                    color: 'white',
                    maxWidth: 'calc(100% - 16px)',
                    '& .MuiChip-label': {
                      px: 1,
                      fontSize: '0.7rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }
                  }}
                />
              </Box>

              <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                <Typography variant="subtitle1" component="div" sx={{ fontWeight: 'bold' }}>
                  {item.title || 'Untitled'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.year || ''}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        )}
      </Box>

      {/* Fix Title Dialog */}
      {selectedTitle && (
        <FixTitleDialog
          open={dialogOpen}
          onClose={handleDialogClose}
          title={selectedTitle}
          onFixed={handleTitleFixed}
        />
      )}
    </Box>
  );
};

export default IgnoredTitlesList;

