import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Card, CardContent, CardMedia, IconButton, CircularProgress, TextField, InputAdornment, Tooltip, ToggleButtonGroup, ToggleButton, useTheme, useMediaQuery, Button, Chip } from '@mui/material';
import { PlaylistAdd, PlaylistAddCheck, Search as SearchIcon, FilterList, CalendarMonth, Star as StarIcon, Movie as MovieIcon, LiveTv as LiveTvIcon, ErrorOutline } from '@mui/icons-material';
import { debounce } from 'lodash';
import { fetchTitles, updateFilters, setSelectedTitle, addToWatchlist, removeFromWatchlist, incrementPage } from '../../store/slices/titlesSlice';
import TitleDetailsDialog from './TitleDetailsDialog';

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
    const { titles, selectedTitle, loading, error, filters, pagination } = useSelector(state => state.titles);
    const theme = useTheme();
    const [loadingItems, setLoadingItems] = useState(new Set());
    const [titleHistory, setTitleHistory] = useState([]);

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

    const handleTitleClick = (title) => {
        setTitleHistory([]);  // Reset history when opening from list
        dispatch(setSelectedTitle(title));
    };

    const handleDialogClose = () => {
        if (titleHistory.length > 0) {
            // Pop the last title from history and show it
            const newHistory = [...titleHistory];
            const lastTitle = newHistory.pop();
            setTitleHistory(newHistory);
            dispatch(setSelectedTitle(lastTitle));
        } else {
            dispatch(setSelectedTitle(null));
        }
    };

    const handleSimilarTitleClick = (newTitle) => {
        // Add current title to history before showing the new one
        if (selectedTitle) {
            setTitleHistory([...titleHistory, selectedTitle]);
        }
        dispatch(setSelectedTitle({ key: newTitle.key }));
    };

    const toggleWatchlist = useCallback(async (titleKey, currentState) => {
        try {
            setLoadingItems(prev => new Set([...prev, titleKey]));
            if (currentState) {
                await dispatch(removeFromWatchlist(titleKey)).unwrap();
            } else {
                await dispatch(addToWatchlist(titleKey)).unwrap();
            }
        } catch (error) {
            console.error('Failed to update watchlist:', error);
        } finally {
            setLoadingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(titleKey);
                return newSet;
            });
        }
    }, [dispatch]);

    const renderAlphabetFilter = () => (
        <Box sx={{
            mb: 2,
            display: {
                xs: 'none', // Hide on mobile
                sm: 'flex'  // Show on screens sm and up
            },
            flexWrap: 'wrap',
            gap: 1
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

    return (
        <Box>
            <Box sx={{ mb: 3 }}>

                {/* Search and Filters */}
                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
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

                    <TextField
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
                        sx={{ width: 120 }}
                    />

                    <ToggleButtonGroup
                        value={filters.watchlistFilter}
                        exclusive
                        onChange={handleWatchlistFilterChange}
                        aria-label="watchlist filter"
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

                    <ToggleButtonGroup
                        value={filters.mediaType}
                        exclusive
                        onChange={handleMediaTypeChange}
                        aria-label="media type"
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

                {renderAlphabetFilter()}

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

            {selectedTitle && (
                <TitleDetailsDialog
                    open={Boolean(selectedTitle)}
                    title={selectedTitle}
                    onClose={handleDialogClose}
                    onWatchlistToggle={() => toggleWatchlist(selectedTitle.key, selectedTitle.watchlist)}
                    onSimilarTitleClick={handleSimilarTitleClick}
                />
            )}
        </Box>
    );
};

export default TitlesList;
