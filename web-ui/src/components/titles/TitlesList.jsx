import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Card, CardContent, CardMedia, IconButton, CircularProgress, TextField, InputAdornment, Tooltip, ToggleButtonGroup, ToggleButton, useTheme, useMediaQuery, Button, Chip, Drawer, Divider, Badge } from '@mui/material';
import { PlaylistAddOutlined as PlaylistAdd, PlaylistAddCheckOutlined as PlaylistAddCheck, SearchOutlined as SearchIcon, FilterListOutlined as FilterList, CalendarMonthOutlined as CalendarMonth, StarOutlined as StarIcon, MovieOutlined as MovieIcon, LiveTvOutlined as LiveTvIcon, ErrorOutline, ChevronLeftOutlined as ChevronLeft, CloseOutlined as Close, ClearOutlined as Clear } from '@mui/icons-material';
import { debounce } from 'lodash';
import { fetchTitles, updateFilters, addToWatchlist, removeFromWatchlist, incrementPage, clearFilters } from '../../store/slices/titlesSlice';

// Base64 encoded placeholder image (1x1 transparent pixel)
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Utility function to sanitize image URLs
const sanitizeImageUrl = (url) => {
    if (!url) return PLACEHOLDER_IMAGE;
    // Remove any duplicate URLs that might have been concatenated
    const cleanUrl = url.split('https://').pop();
    return cleanUrl ? `https://${cleanUrl}` : PLACEHOLDER_IMAGE;
};

const MEDIA_TYPE_OPTIONS = [
    { value: '', label: 'All', icon: <FilterList /> },
    { value: 'movies', label: 'Movies', icon: <MovieIcon /> },
    { value: 'tvshows', label: 'TV Shows', icon: <LiveTvIcon /> }
];

const ALPHABET_FILTERS = [
    '#',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'
];

const TitlesList = ({ title, searchQuery = '', onSearchChange }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { titles, loading, error, filters, pagination } = useSelector(state => state.titles);
    const theme = useTheme();
    const [loadingItems, setLoadingItems] = useState(new Set());

    // Define breakpoints for different screen sizes
    const isXSmall = useMediaQuery(theme.breakpoints.down('sm'));
    const isSmall = useMediaQuery(theme.breakpoints.between('sm', 'md'));
    
    // Sidebar state with localStorage persistence
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('titlesSidebarOpen');
        return saved !== null ? JSON.parse(saved) : !isXSmall;
    });

    // Persist sidebar state to localStorage
    useEffect(() => {
        localStorage.setItem('titlesSidebarOpen', JSON.stringify(sidebarOpen));
    }, [sidebarOpen]);
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

    const observer = useRef();
    const lastTitleElementRef = useCallback(node => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && pagination.page < pagination.total_pages) {
                dispatch(incrementPage());
                dispatch(fetchTitles());
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

    // Initial fetch
    useEffect(() => {
        dispatch(fetchTitles());
    }, [dispatch, filters]);

    // Handle local search change
    const handleLocalSearchChange = useCallback((event) => {
        const value = event.target.value;
        onSearchChange(event);
        dispatch(updateFilters({ searchQuery: value }));
    }, [onSearchChange, dispatch]);

    // Handle year filter change
    const handleYearFilterChange = useCallback((event) => {
        const value = event.target.value;
        dispatch(updateFilters({ yearFilter: value }));
    }, [dispatch]);

    // Handle watchlist filter change
    const handleWatchlistFilterChange = (event, newFilter) => {
        if (newFilter !== null) {
            dispatch(updateFilters({ watchlistFilter: newFilter }));
        }
    };

    // Handle letter filtering
    const handleLetterFilter = (letter) => {
        dispatch(updateFilters({
            selectedLetter: letter === filters.selectedLetter ? '' : letter
        }));
    };

    // Handle media type change
    const handleMediaTypeChange = (event, newValue) => {
        dispatch(updateFilters({ mediaType: newValue }));
    };

    // Handle clear all filters
    const handleClearFilters = () => {
        dispatch(clearFilters());
        // Also clear the search query in parent component if callback is provided
        if (onSearchChange) {
            const syntheticEvent = {
                target: { value: '' }
            };
            onSearchChange(syntheticEvent);
        }
        dispatch(fetchTitles());
    };

    const handleTitleClick = (title) => {
        // Navigate to URL-based title details page
        // Parse title key (format: type-titleId)
        const [type, titleId] = title.key.split('-');
        navigate(`/media/vod/${type}/${titleId}`);
    };

    const toggleWatchlist = useCallback(async (titleKey, currentState) => {
        try {
            setLoadingItems(prev => new Set([...prev, titleKey]));
            if (currentState) {
                await dispatch(removeFromWatchlist(titleKey)).unwrap();
            } else {
                await dispatch(addToWatchlist(titleKey)).unwrap();
            }
            // The Redux state will be updated by the reducer, which will cause
            // selectedTitle to update, which will cause the dialog to re-render
        } catch (error) {
            console.error('Failed to update watchlist:', error);
            // On error, we might want to revert the optimistic update
            // but since we're using Redux, the state won't have changed
        } finally {
            setLoadingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(titleKey);
                return newSet;
            });
        }
    }, [dispatch]);

    // Calculate active filter count for badge
    const getActiveFilterCount = useCallback(() => {
        let count = 0;
        if (filters.yearFilter) count++;
        if (filters.watchlistFilter && filters.watchlistFilter !== 'all') count++;
        if (filters.mediaType) count++;
        if (filters.selectedLetter) count++;
        return count;
    }, [filters]);

    const activeFilterCount = getActiveFilterCount();

    const renderAlphabetFilter = () => (
        <Box sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            mb: 2
        }}>
            {ALPHABET_FILTERS.map((letter) => (
                <Button
                    key={letter}
                    variant={filters.selectedLetter === letter ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => handleLetterFilter(letter)}
                    sx={{ minWidth: '36px' }}
                >
                    {letter}
                </Button>
            ))}
        </Box>
    );

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

                    {/* Year Filter */}
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Year
                        </Typography>
                        <TextField
                            fullWidth
                            placeholder="Year"
                            value={filters.yearFilter || ''}
                            onChange={handleYearFilterChange}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <CalendarMonth />
                                    </InputAdornment>
                                ),
                            }}
                            size="small"
                        />
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
                            <ToggleButton value="all" aria-label="all titles">
                                <Tooltip title="All Titles">
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

                    {/* Alphabet Filter */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Filter by Letter
                        </Typography>
                        {renderAlphabetFilter()}
                    </Box>
                </Box>
            </Drawer>

            {/* Main Content Area */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    minWidth: 0, // Prevent overflow
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
                                    display: { xs: 'none', sm: 'block' } // Hide on mobile to save space
                                }}
                            >
                                {pagination.total === 0 
                                    ? 'No titles available' 
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
                                display: { xs: 'block', sm: 'none' } // Show only on mobile
                            }}
                        >
                            {pagination.total === 0 
                                ? 'No titles available' 
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
                        key={item.key}
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

                            {/* Watchlist Button */}
                            <IconButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!loadingItems.has(item.key)) {
                                        toggleWatchlist(item.key, item.watchlist);
                                    }
                                }}
                                disabled={loadingItems.has(item.key)}
                                sx={{
                                    position: 'absolute',
                                    top: 8,
                                    right: 8,
                                    backgroundColor: item.watchlist ? 'success.main' : 'rgba(0, 0, 0, 0.5)',
                                    color: 'white',
                                    '&:hover': {
                                        backgroundColor: item.watchlist ? 'success.dark' : 'rgba(0, 0, 0, 0.7)',
                                    }
                                }}
                            >
                                {loadingItems.has(item.key) ? (
                                    <CircularProgress size={24} color="inherit" />
                                ) : item.watchlist ? (
                                    <PlaylistAddCheck />
                                ) : (
                                    <PlaylistAdd />
                                )}
                            </IconButton>

                            <CardMedia
                                component="img"
                                height="300"
                                image={sanitizeImageUrl(item.image)}
                                alt={item.name}
                                sx={{ objectFit: 'cover' }}
                            />

                            {/* Show Info for TV Shows */}
                            {item.type === 'tvshows' && (
                                <Chip
                                    label={`${item.number_of_seasons} Season${item.number_of_seasons !== 1 ? 's' : ''} • ${item.number_of_episodes} Episode${item.number_of_episodes !== 1 ? 's' : ''}`}
                                    size="small"
                                    sx={{
                                        position: 'absolute',
                                        bottom: 8,
                                        left: 8,
                                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                                        color: 'white',
                                        '& .MuiChip-label': {
                                            px: 1
                                        }
                                    }}
                                />
                            )}

                            {/* Rating */}
                            {item.vote_average > 0 && (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        bottom: 8,
                                        right: 8,
                                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                                        color: 'white',
                                        borderRadius: 1,
                                        px: 1,
                                        py: 0.5,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5
                                    }}
                                >
                                    <StarIcon sx={{ fontSize: '1rem', color: 'warning.main' }} />
                                    <Typography variant="body2">{item.vote_average.toFixed(1)}</Typography>
                                    <Typography variant="caption" sx={{ opacity: 0.7 }}>({item.vote_count})</Typography>
                                </Box>
                            )}
                        </Box>

                        <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                            <Typography variant="subtitle1" component="div" sx={{ fontWeight: 'bold' }}>
                                {item.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {item.release_date ? new Date(item.release_date).getFullYear() : ''}
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
        </Box>
    );
};

export default TitlesList;
