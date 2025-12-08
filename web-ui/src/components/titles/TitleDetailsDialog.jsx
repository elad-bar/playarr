import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Typography,
    Box,
    Chip,
    Grid,
    CircularProgress,
    Card,
    CardContent,
    CardMedia,
    Tooltip
} from '@mui/material';
import {
    CloseOutlined as CloseIcon,
    PlaylistAddOutlined as PlaylistAdd,
    PlaylistAddCheckOutlined as PlaylistAddCheck,
    MovieOutlined as Movie,
    TvOutlined as Tv,
    CalendarMonthOutlined as CalendarMonth,
    StreamOutlined as Stream,
    DownloadOutlined as DownloadIcon
} from '@mui/icons-material';
import SimilarTitles from './SimilarTitles';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';
import { API_URL } from '../../config/index';
import { authService } from '../../services/auth';

// Base64 encoded placeholder image (1x1 transparent pixel)
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Utility function to sanitize image URLs
const sanitizeImageUrl = (url) => {
    if (!url) return PLACEHOLDER_IMAGE;
    // Remove any duplicate URLs that might have been concatenated
    const cleanUrl = url.split('https://').pop();
    return cleanUrl ? `https://${cleanUrl}` : PLACEHOLDER_IMAGE;
};

// Utility to parse season and episode from stream id (e.g., 'S01E01')
const parseSeasonEpisodeFromId = (id) => {
    const match = id && id.match(/^S(\d+)E(\d+)$/i);
    if (match) {
        return {
            season: parseInt(match[1], 10),
            episode: parseInt(match[2], 10)
        };
    }
    return null;
};

// Group streams by season using parsed id
const getSeasonStreams = (streams) => {
    return streams.reduce((acc, stream) => {
        const info = parseSeasonEpisodeFromId(stream.id);
        if (info) {
            const season = info.season;
            if (!acc[season]) acc[season] = [];
            acc[season].push({
                ...stream,
                episodeNumber: info.episode
            });
        } else {
            // fallback: group under 'Unknown'
            if (!acc['Unknown']) acc['Unknown'] = [];
            acc['Unknown'].push({ ...stream, episodeNumber: null });
        }
        return acc;
    }, {});
};

// Group streams by season and episode from grouped structure
const groupStreamsBySeasonEpisode = (streams) => {
  const result = {};
  streams.forEach(stream => {
    let season = stream.season;
    let episode = stream.episode;
    
    // Parse from stream ID if season/episode not provided
    if (!season || !episode) {
      const info = parseSeasonEpisodeFromId(stream.id);
      if (info) {
        season = `S${String(info.season).padStart(2, '0')}`;
        episode = `E${String(info.episode).padStart(2, '0')}`;
      }
    } else {
      // Convert numeric season/episode to string format (S01, E01)
      if (typeof season === 'number') {
        season = `S${String(season).padStart(2, '0')}`;
      } else if (typeof season === 'string' && !season.startsWith('S')) {
        // If it's already a string but not in S01 format, convert it
        season = `S${season.padStart(2, '0')}`;
      }
      
      if (typeof episode === 'number') {
        episode = `E${String(episode).padStart(2, '0')}`;
      } else if (typeof episode === 'string' && !episode.startsWith('E')) {
        // If it's already a string but not in E01 format, convert it
        episode = `E${episode.padStart(2, '0')}`;
      }
    }
    
    // Ensure season and episode are strings before using replace
    if (season && episode && typeof season === 'string' && typeof episode === 'string') {
      const seasonNum = season.replace(/[^\d]/g, '');
      const episodeNum = episode.replace(/[^\d]/g, '');
      if (!result[seasonNum]) result[seasonNum] = {};
      if (!result[seasonNum][episodeNum]) result[seasonNum][episodeNum] = [];
      result[seasonNum][episodeNum].push(stream);
    } else {
      if (!result['Unknown']) result['Unknown'] = {};
      if (!result['Unknown'][stream.id]) result['Unknown'][stream.id] = [];
      result['Unknown'][stream.id].push(stream);
    }
  });
  return result;
};

const TitleDetailsDialog = ({ open, onClose, title, onWatchlistToggle, onSimilarTitleClick }) => {
    const [selectedSeason, setSelectedSeason] = useState(null);
    const [similarTitles, setSimilarTitles] = useState([]);
    const [loadingSimilar, setLoadingSimilar] = useState(false);
    const [fullTitleDetails, setFullTitleDetails] = useState(null);
    const [apiKey, setApiKey] = useState(null);

    useEffect(() => {
        if (!open || !title?.key) return;
        setLoadingSimilar(true);
        setFullTitleDetails(null);
        setSimilarTitles([]);
        // Fetch title details (including similar_titles) only once
        const fetchDetails = async () => {
            try {
                const response = await axiosInstance.get(API_ENDPOINTS.titleDetails(title.key));
                const data = response.data;
                setFullTitleDetails(data);
                if (data.similar_titles && data.similar_titles.length > 0) {
                    setSimilarTitles(data.similar_titles);
                } else {
                    setSimilarTitles([]);
                }
            } catch (error) {
                console.error('Error fetching title details:', error);
                setFullTitleDetails(null);
                setSimilarTitles([]);
            } finally {
                setLoadingSimilar(false);
            }
        };
        fetchDetails();
    }, [open, title?.key]);

    // Fetch API key when dialog opens
    useEffect(() => {
        if (open) {
            const fetchApiKey = async () => {
                try {
                    const profile = await authService.getProfile();
                    setApiKey(profile.api_key);
                } catch (error) {
                    console.error('Error fetching API key:', error);
                }
            };
            fetchApiKey();
        }
    }, [open]);

    useEffect(() => {
        // Set the first season as selected when title changes or streams load
        const details = fullTitleDetails || title;
        if (details?.type === 'tvshows' && details.streams?.length > 0) {
            const seasonStreams = getSeasonStreams(details.streams);
            const seasons = Object.keys(seasonStreams).sort((a, b) => parseInt(a) - parseInt(b));
            setSelectedSeason(seasons[0]);
        }
    }, [fullTitleDetails, title]);

    // Update fullTitleDetails watchlist status when title prop changes
    useEffect(() => {
        if (fullTitleDetails && title && fullTitleDetails.key === title.key && fullTitleDetails.watchlist !== title.watchlist) {
            setFullTitleDetails(prev => ({
                ...prev,
                watchlist: title.watchlist
            }));
        }
    }, [title, fullTitleDetails]);

    const handleSeasonChange = (season) => {
        setSelectedSeason(season);
    };

    const handleWatchlistToggle = async () => {
        if (!title) return;
        // Optimistically update the UI immediately
        // Use title.watchlist as source of truth, fallback to fullTitleDetails
        const currentWatchlistStatus = title.watchlist ?? fullTitleDetails?.watchlist ?? false;
        const newWatchlistStatus = !currentWatchlistStatus;
        
        // Update fullTitleDetails immediately for instant UI feedback
        setFullTitleDetails(prev => prev ? {
            ...prev,
            watchlist: newWatchlistStatus
        } : null);
        
        // Trigger the Redux action which will update the title prop
        onWatchlistToggle();
    };

    const handleStreamDownload = async (titleId, seasonNumber = null, episodeNumber = null) => {
        try {
            // Get API key if not already loaded
            let userApiKey = apiKey;
            if (!userApiKey) {
                try {
                    const profile = await authService.getProfile();
                    userApiKey = profile.api_key;
                    setApiKey(userApiKey);
                } catch (error) {
                    console.error('Error fetching API key:', error);
                    alert('Unable to get API key. Please try again.');
                    return;
                }
            }

            let streamUrl;
            if (seasonNumber !== null && episodeNumber !== null) {
                // Show episode
                streamUrl = API_ENDPOINTS.streamShow(titleId, seasonNumber, episodeNumber);
            } else {
                // Movie
                streamUrl = API_ENDPOINTS.streamMovie(titleId);
            }

            // Construct full URL that works with both direct connection and reverse proxy
            // API_URL can be: http://localhost:5000/api, /api, or https://example.com/api
            // Endpoints are: /api/stream/...
            let fullUrl;
            if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
                // Absolute URL - strip /api suffix if present, then add endpoint
                const baseUrl = API_URL.endsWith('/api') ? API_URL.slice(0, -4) : API_URL.replace(/\/api$/, '');
                fullUrl = `${baseUrl}${streamUrl}`;
            } else {
                // Relative URL - use endpoint directly (it already starts with /)
                fullUrl = streamUrl;
            }

            // Append API key as query parameter
            const separator = fullUrl.includes('?') ? '&' : '?';
            fullUrl = `${fullUrl}${separator}api_key=${encodeURIComponent(userApiKey)}`;

            window.open(fullUrl, '_blank');
        } catch (error) {
            console.error('Error opening stream:', error);
        }
    };

    // Helper to extract season/episode numbers from stream
    const extractSeasonEpisode = (stream) => {
        if (stream.season && stream.episode) {
            // Handle numeric season/episode from API
            const seasonStr = typeof stream.season === 'number' ? stream.season.toString() : stream.season;
            const episodeStr = typeof stream.episode === 'number' ? stream.episode.toString() : stream.episode;
            const seasonNum = parseInt(seasonStr.replace(/[^\d]/g, ''));
            const episodeNum = parseInt(episodeStr.replace(/[^\d]/g, ''));
            return { seasonNum, episodeNum };
        }
        const info = parseSeasonEpisodeFromId(stream.id);
        if (info) {
            return { seasonNum: info.season, episodeNum: info.episode };
        }
        return null;
    };

    const handleSimilarTitleClick = (similarTitle) => {
        onSimilarTitleClick(similarTitle);
    };

    // Use fullTitleDetails if available, otherwise fallback to prop
    const details = fullTitleDetails || title;

    if (!open) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullScreen
            PaperProps={{
                sx: {
                    background: 'rgb(18, 18, 18)',
                    backgroundImage: details?.backdrop_path ? `linear-gradient(rgba(18, 18, 18, 0.95), rgba(18, 18, 18, 0.95)), url(${details.backdrop_path})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundAttachment: 'fixed',
                    color: 'white'
                }
            }}
        >
            <DialogTitle
                sx={{
                    m: 0,
                    p: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}
            >
                <Typography
                    variant="h5"
                    component="span"
                    sx={{ color: 'white', fontWeight: 500 }}
                >
                    {details?.name}
                </Typography>
                <IconButton onClick={onClose} sx={{ color: 'white' }}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
                {!details ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : (
                    <Box sx={{ p: 3 }}>
                        <Grid container spacing={4}>
                            <Grid item xs={12} sm={4} md={3} lg={2}>
                                <Box
                                    component="img"
                                    src={sanitizeImageUrl(details.poster_path)}
                                    alt={details.name}
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = PLACEHOLDER_IMAGE;
                                    }}
                                    sx={{
                                        width: '100%',
                                        height: 'auto',
                                        maxHeight: '500px',
                                        objectFit: 'cover',
                                        borderRadius: 1,
                                        display: 'block',
                                        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
                                    }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={8} md={9} lg={10}>
                                <Box display="flex" flexDirection="column" gap={3}>
                                    <Box display="flex" alignItems="center" gap={2}>
                                        <Box
                                            display="flex"
                                            gap={1}
                                            flexWrap="wrap"
                                            rowGap={1}
                                            width="100%"
                                            minWidth={0}
                                        >
                                            <Chip
                                                icon={details.type === 'tvshows' ? <Tv /> : <Movie />}
                                                label={details.type === 'tvshows' ? 'TV Show' : 'Movie'}
                                                size="small"
                                                sx={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                                    color: 'white',
                                                    '& .MuiSvgIcon-root': { color: 'white' },
                                                    flexShrink: 0
                                                }}
                                            />
                                            {details.release_date && (
                                                <Chip
                                                    icon={<CalendarMonth />}
                                                    label={new Date(details.release_date).getFullYear()}
                                                    size="small"
                                                    sx={{
                                                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                                        color: 'white',
                                                        '& .MuiSvgIcon-root': { color: 'white' },
                                                        flexShrink: 0
                                                    }}
                                                />
                                            )}
                                            {details.streams?.length > 0 && (
                                                <Chip
                                                    icon={<Stream />}
                                                    label={`${details.streams.length} ${details.type === 'tvshows' ? 'Episodes' : 'Available'}`}
                                                    size="small"
                                                    sx={{
                                                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                                        color: 'white',
                                                        '& .MuiSvgIcon-root': { color: 'white' },
                                                        flexShrink: 0
                                                    }}
                                                />
                                            )}
                                            <Chip
                                                icon={details.watchlist ? <PlaylistAddCheck /> : <PlaylistAdd />}
                                                label={details.watchlist ? "In Watchlist" : "Add to Watchlist"}
                                                onClick={handleWatchlistToggle}
                                                size="small"
                                                sx={{
                                                    backgroundColor: details.watchlist ? 'success.main' : 'rgba(255, 255, 255, 0.08)',
                                                    color: 'white',
                                                    '& .MuiSvgIcon-root': { color: 'white' },
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    '&:hover': {
                                                        backgroundColor: details.watchlist ? 'success.dark' : 'rgba(255, 255, 255, 0.12)'
                                                    }
                                                }}
                                            />
                                            {details.type === 'movies' && (
                                                <Chip
                                                    icon={<DownloadIcon />}
                                                    label="Download"
                                                    onClick={() => handleStreamDownload(details.id)}
                                                    size="small"
                                                    disabled={!details.streams || details.streams.length === 0}
                                                    sx={{
                                                        backgroundColor: (!details.streams || details.streams.length === 0) ? 'rgba(255, 255, 255, 0.08)' : 'primary.main',
                                                        color: 'white',
                                                        '& .MuiSvgIcon-root': { color: 'white' },
                                                        cursor: (!details.streams || details.streams.length === 0) ? 'not-allowed' : 'pointer',
                                                        flexShrink: 0,
                                                        '&:hover': {
                                                            backgroundColor: (!details.streams || details.streams.length === 0) ? 'rgba(255, 255, 255, 0.08)' : 'primary.dark'
                                                        }
                                                    }}
                                                />
                                            )}
                                        </Box>
                                    </Box>

                                    {details.overview && (
                                        <Typography sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                                            {details.overview}
                                        </Typography>
                                    )}

                                    {details.type === 'tvshows' && details.streams && details.streams.length > 0 && (
                                        <Box>
                                            <Typography variant="h6" gutterBottom sx={{ color: 'white', mb: 2 }}>
                                                Episodes
                                            </Typography>
                                            {(() => {
                                                const grouped = groupStreamsBySeasonEpisode(details.streams || []);
                                                const seasons = grouped ? Object.keys(grouped).sort((a, b) => parseInt(a) - parseInt(b)) : [];
                                                const selected = selectedSeason && grouped && grouped[selectedSeason] ? selectedSeason : (seasons[0] || null);

                                                return (
                                                    <>
                                                        {/* Season Tabs */}
                                                        <Box sx={{ mb: 3, display: 'flex', gap: 1, flexWrap: 'wrap', p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                                            {seasons.map(season => (
                                                                <Chip
                                                                    key={season}
                                                                    label={season === 'Unknown' ? 'Unknown Season' : `Season ${parseInt(season, 10)}`}
                                                                    onClick={() => handleSeasonChange(season)}
                                                                    sx={{
                                                                        bgcolor: selected === season ? 'primary.main' : 'rgba(255, 255, 255, 0.08)',
                                                                        color: 'white',
                                                                        '&:hover': {
                                                                            bgcolor: selected === season ? 'primary.dark' : 'rgba(255, 255, 255, 0.15)'
                                                                        }
                                                                    }}
                                                                />
                                                            ))}
                                                        </Box>
                                                        {/* Episodes Grid */}
                                                        {selected && grouped[selected] && (
                                                            <Grid container spacing={2}>
                                                                {Object.keys(grouped[selected])
                                                                    .sort((a, b) => parseInt(a) - parseInt(b))
                                                                    .map(episodeNum => {
                                                                        const episodes = grouped[selected][episodeNum] || [];
                                                                        const firstEpisode = episodes[0];
                                                                        if (!firstEpisode) return null;

                                                                        const episodeInfo = extractSeasonEpisode(firstEpisode);
                                                                        if (!episodeInfo) return null;

                                                                        // Extract episode details from firstEpisode
                                                                        const episodeName = firstEpisode.name || `Episode ${parseInt(episodeNum, 10)}`;
                                                                        const episodeAirDate = firstEpisode.air_date;
                                                                        const episodeOverview = firstEpisode.overview;
                                                                        const episodeStillPath = firstEpisode.still_path;

                                                                        return (
                                                                            <Grid item xs={6} sm={4} md={3} lg={2} key={`${selected}-${episodeNum}`}>
                                                                                <Card sx={{
                                                                                    bgcolor: 'rgba(255, 255, 255, 0.03)',
                                                                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                                                                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.05)' },
                                                                                    height: '100%',
                                                                                    display: 'flex',
                                                                                    flexDirection: 'column'
                                                                                }}>
                                                                                    {episodeStillPath && (
                                                                                        <CardMedia
                                                                                            component="img"
                                                                                            height="140"
                                                                                            image={sanitizeImageUrl(episodeStillPath)}
                                                                                            alt={episodeName}
                                                                                            sx={{
                                                                                                objectFit: 'cover',
                                                                                                bgcolor: 'rgba(255, 255, 255, 0.05)'
                                                                                            }}
                                                                                            onError={(e) => {
                                                                                                e.target.src = PLACEHOLDER_IMAGE;
                                                                                            }}
                                                                                        />
                                                                                    )}
                                                                                    <CardContent sx={{ p: 1.5, pb: 1.5, position: 'relative', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                                                                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                                                                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                                                                <Tooltip title={episodeOverview || episodeName} arrow>
                                                                                                    <Typography 
                                                                                                        variant="body2" 
                                                                                                        sx={{ 
                                                                                                            color: 'white', 
                                                                                                            fontWeight: 500,
                                                                                                            overflow: 'hidden',
                                                                                                            textOverflow: 'ellipsis',
                                                                                                            display: '-webkit-box',
                                                                                                            WebkitLineClamp: 2,
                                                                                                            WebkitBoxOrient: 'vertical'
                                                                                                        }}
                                                                                                    >
                                                                                                        {episodeName}
                                                                                                    </Typography>
                                                                                                </Tooltip>
                                                                                                {episodeAirDate && (
                                                                                                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.6)', display: 'block', mt: 0.5 }}>
                                                                                                        {new Date(episodeAirDate).toLocaleDateString()}
                                                                                                    </Typography>
                                                                                                )}
                                                                                            </Box>
                                                                                            <IconButton
                                                                                                size="small"
                                                                                                onClick={() => handleStreamDownload(details.id, episodeInfo.seasonNum, episodeInfo.episodeNum)}
                                                                                                sx={{
                                                                                                    color: 'white',
                                                                                                    bgcolor: 'primary.main',
                                                                                                    width: 32,
                                                                                                    height: 32,
                                                                                                    ml: 1,
                                                                                                    flexShrink: 0,
                                                                                                    '&:hover': {
                                                                                                        bgcolor: 'primary.dark'
                                                                                                    }
                                                                                                }}
                                                                                            >
                                                                                                <DownloadIcon fontSize="small" />
                                                                                            </IconButton>
                                                                                        </Box>
                                                                                        {episodeOverview && (
                                                                                            <Tooltip title={episodeOverview} arrow>
                                                                                                <Typography 
                                                                                                    variant="caption" 
                                                                                                    sx={{ 
                                                                                                        color: 'rgba(255, 255, 255, 0.7)', 
                                                                                                        mt: 1,
                                                                                                        overflow: 'hidden',
                                                                                                        textOverflow: 'ellipsis',
                                                                                                        display: '-webkit-box',
                                                                                                        WebkitLineClamp: 2,
                                                                                                        WebkitBoxOrient: 'vertical'
                                                                                                    }}
                                                                                                >
                                                                                                    {episodeOverview}
                                                                                                </Typography>
                                                                                            </Tooltip>
                                                                                        )}
                                                                                    </CardContent>
                                                                                </Card>
                                                                            </Grid>
                                                                        );
                                                                    })}
                                                            </Grid>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </Box>
                                    )}
                                </Box>
                            </Grid>
                            <Grid item xs={12}>
                                {/* Similar Titles Section */}
                                {(similarTitles.length > 0 || loadingSimilar) && (
                                    <Box sx={{ mt: 4 }}>
                                        <Typography variant="h6" gutterBottom sx={{ color: 'white', mb: 2 }}>
                                            Recommendations
                                        </Typography>
                                        <SimilarTitles
                                            titles={similarTitles}
                                            loading={loadingSimilar}
                                            onTitleClick={handleSimilarTitleClick}
                                        />
                                    </Box>
                                )}
                            </Grid>
                        </Grid>
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default TitleDetailsDialog;
