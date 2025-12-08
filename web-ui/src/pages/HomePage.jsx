import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    CardHeader,
    Grid,
    Typography,
    CircularProgress,
    Alert,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    useTheme,
} from '@mui/material';
import {
    PeopleOutlined as PeopleIcon,
    MovieOutlined as MovieIcon,
    TvOutlined as TvIcon,
    PlayArrowOutlined as PlayIcon,
    RefreshOutlined as RefreshIcon,
    StarOutlined as StarIcon,
} from '@mui/icons-material';
import { getMediaTypeColors } from '../components/settings/iptv/utils';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

/**
 * Format number with commas
 */
const formatNumber = (num) => {
    if (num === null || num === undefined) return '0';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);
};

/**
 * Get Chart.js options for bar charts with Material-UI theme integration
 */
const getBarChartOptions = (theme, labelKey, stacked = false, horizontal = false) => ({
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: true,
            position: 'top',
            labels: {
                color: theme.palette.text.primary,
                usePointStyle: true,
            },
        },
        tooltip: {
            callbacks: {
                label: (context) => {
                    const value = horizontal ? context.parsed.x : context.parsed.y;
                    return `${context.dataset.label || ''}: ${formatNumber(value)}`;
                },
            },
        },
    },
    scales: {
        x: {
            stacked: horizontal ? stacked : false,
            ticks: {
                color: theme.palette.text.secondary,
                ...(horizontal ? {} : { maxRotation: -45, minRotation: -45 }),
            },
            grid: {
                color: theme.palette.mode === 'dark' 
                    ? 'rgba(255, 255, 255, 0.1)' 
                    : 'rgba(0, 0, 0, 0.1)',
                drawBorder: false,
            },
            beginAtZero: horizontal ? true : undefined,
        },
        y: {
            stacked: horizontal ? false : stacked,
            ticks: {
                color: theme.palette.text.secondary,
            },
            grid: {
                color: theme.palette.mode === 'dark' 
                    ? 'rgba(255, 255, 255, 0.1)' 
                    : 'rgba(0, 0, 0, 0.1)',
                drawBorder: false,
            },
            beginAtZero: horizontal ? undefined : true,
        },
    },
});

/**
 * Transform Recharts bar chart data format to Chart.js format
 * Input: [{ labelKey: 'label1', value: 10 }, ...]
 * Output: { labels: ['label1', ...], datasets: [{ data: [10, ...] }] }
 */
const transformBarChartData = (data, labelKey, valueKey, color, label = '') => {
    const labels = data.map(item => item[labelKey]);
    const values = data.map(item => item[valueKey]);
    
    return {
        labels,
        datasets: [{
            label: label || valueKey,
            data: values,
            backgroundColor: color,
        }],
    };
};

/**
 * Transform stacked bar chart data format to Chart.js format
 * Input: [{ labelKey: 'label1', success: 10, failure: 5 }, ...]
 * Output: { labels: ['label1', ...], datasets: [{ label: 'Success', data: [10, ...] }, { label: 'Failure', data: [5, ...] }] }
 */
const transformStackedBarChartData = (data, labelKey, datasets) => {
    const labels = data.map(item => item[labelKey]);
    
    const chartDatasets = datasets.map(dataset => ({
        label: dataset.label,
        data: data.map(item => item[dataset.key]),
        backgroundColor: dataset.color,
    }));
    
    return {
        labels,
        datasets: chartDatasets,
    };
};

/**
 * Home page component displaying Prometheus metrics dashboard
 */
const HomePage = () => {
    const theme = useTheme();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    /**
     * Fetch metrics from API
     */
    const fetchMetrics = async () => {
        try {
            setError(null);
            // Use absolute URL since metrics endpoint is at /metrics (not /api/metrics)
            const response = await fetch('/metrics/json', {
                method: 'GET',
                credentials: 'include', // Include cookies for JWT authentication
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            // Convert array format to object format for easier access
            const metricsObject = {};
            if (Array.isArray(data)) {
                data.forEach(metric => {
                    if (metric.name) {
                        metricsObject[metric.name] = metric;
                    }
                });
            } else {
                // If it's already an object, use it as is
                Object.assign(metricsObject, data);
            }
            setMetrics(metricsObject);
        } catch (err) {
            const errorMessage = err.message || 'Failed to load metrics';
            setError(`Failed to load home data: ${errorMessage}`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchMetrics();
    }, []);

    /**
     * Handle manual refresh
     */
    const handleRefresh = () => {
        setRefreshing(true);
        fetchMetrics();
    };

    /**
     * Extract metric value by name
     */
    const getMetricValue = (metricName) => {
        if (!metrics || !metrics[metricName]) return 0;
        const metric = metrics[metricName];
        if (metric.values && metric.values.length > 0) {
            // Sum all values if multiple
            return metric.values.reduce((sum, item) => sum + (item.value || 0), 0);
        }
        return 0;
    };

    /**
     * Get metric values with labels
     */
    const getMetricValuesWithLabels = (metricName) => {
        if (!metrics || !metrics[metricName]) return [];
        const metric = metrics[metricName];
        if (metric.values && metric.values.length > 0) {
            return metric.values.map(item => ({
                ...item.labels,
                value: item.value || 0
            }));
        }
        return [];
    };

    /**
     * Calculate totals for metrics with labels
     */
    const getTotalForMetric = (metricName) => {
        const values = getMetricValuesWithLabels(metricName);
        return values.reduce((sum, item) => sum + (item.value || 0), 0);
    };

    // Summary card data
    const activeUsers = getMetricValue('playarr_active_users');
    const mainTitlesData = getMetricValuesWithLabels('playarr_main_titles_count');
    const totalMovies = mainTitlesData
        .filter(item => item.media_type === 'movies')
        .reduce((sum, item) => sum + (item.value || 0), 0);
    const totalTVShows = mainTitlesData
        .filter(item => item.media_type === 'tvshows')
        .reduce((sum, item) => sum + (item.value || 0), 0);
    const totalTitles = totalMovies + totalTVShows; // Keep for empty state check
    const totalChannels = getTotalForMetric('playarr_channels_count');
    const totalEpisodes = getTotalForMetric('playarr_episodes_count');

    // Job Executions data
    const jobExecutionsData = getMetricValuesWithLabels('playarr_job_executions_total');
    const jobExecutionsByType = {};
    jobExecutionsData.forEach(item => {
        const jobType = item.job_type || 'unknown';
        const status = item.status || 'unknown';
        if (!jobExecutionsByType[jobType]) {
            jobExecutionsByType[jobType] = { success: 0, failure: 0 };
        }
        if (status === 'success') {
            jobExecutionsByType[jobType].success += item.value;
        } else {
            jobExecutionsByType[jobType].failure += item.value;
        }
    });
    const jobExecutionsChartData = Object.entries(jobExecutionsByType).map(([jobType, counts]) => ({
        jobType,
        success: counts.success,
        failure: counts.failure,
    }));

    // Stream Requests data
    const streamRequestsData = getMetricValuesWithLabels('playarr_stream_requests_total');
    const streamRequestsByUser = {};
    streamRequestsData.forEach(item => {
        const user = item.user || 'unknown';
        if (!streamRequestsByUser[user]) {
            streamRequestsByUser[user] = 0;
        }
        streamRequestsByUser[user] += item.value;
    });
    const streamRequestsChartData = Object.entries(streamRequestsByUser)
        .map(([user, value]) => ({ user, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10); // Top 10 users

    // Provider Statistics
    const providerTitlesData = getMetricValuesWithLabels('playarr_provider_titles_count');
    const providerChannelsData = getMetricValuesWithLabels('playarr_channels_count');
    const providerActiveData = getMetricValuesWithLabels('playarr_provider_active');
    const providerExpirationDaysData = getMetricValuesWithLabels('playarr_provider_expiration_days');
    const ignoredTitlesData = getMetricValuesWithLabels('playarr_ignored_provider_titles_count');
    
    const providerStats = {};
    
    // Aggregate provider titles by media type (movies and tvshows)
    providerTitlesData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        const mediaType = item.media_type || 'unknown';
        
        if (!providerStats[providerId]) {
            providerStats[providerId] = { 
                providerId, 
                movies: 0, 
                shows: 0, 
                channels: 0,
                active: false,
                expirationDays: null
            };
        }
        
        if (mediaType === 'movies') {
            providerStats[providerId].movies += item.value;
        } else if (mediaType === 'tvshows') {
            providerStats[providerId].shows += item.value;
        }
    });
    
    // Aggregate ignored provider titles by media type (movies and tvshows) - separate structure for chart
    const ignoredStats = {};
    ignoredTitlesData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        const mediaType = item.media_type || 'unknown';
        
        if (!ignoredStats[providerId]) {
            ignoredStats[providerId] = { 
                providerId, 
                ignoredMovies: 0, 
                ignoredShows: 0
            };
        }
        
        // Split ignored counts by media type
        if (mediaType === 'movies') {
            ignoredStats[providerId].ignoredMovies += item.value;
        } else if (mediaType === 'tvshows') {
            ignoredStats[providerId].ignoredShows += item.value;
        }
    });
    
    // Aggregate provider channels
    providerChannelsData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        if (!providerStats[providerId]) {
            providerStats[providerId] = { 
                providerId, 
                movies: 0, 
                shows: 0, 
                channels: 0,
                active: false,
                expirationDays: null
            };
        }
        providerStats[providerId].channels += item.value;
    });
    
    // Set provider active status
    providerActiveData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        if (!providerStats[providerId]) {
            providerStats[providerId] = { 
                providerId, 
                movies: 0, 
                shows: 0, 
                channels: 0,
                active: false,
                expirationDays: null
            };
        }
        providerStats[providerId].active = item.value === 1;
    });
    
    // Set provider expiration days
    providerExpirationDaysData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        if (!providerStats[providerId]) {
            providerStats[providerId] = { 
                providerId, 
                movies: 0, 
                shows: 0, 
                channels: 0,
                active: false,
                expirationDays: null
            };
        }
        // -999999 is the sentinel value for "no expiration date"
        const days = item.value;
        providerStats[providerId].expirationDays = (days === -999999) ? null : days;
    });
    
    const providerStatsArray = Object.values(providerStats).sort((a, b) => {
        const totalA = a.movies + a.shows + a.channels;
        const totalB = b.movies + b.shows + b.channels;
        return totalB - totalA;
    });
    
    const ignoredStatsArray = Object.values(ignoredStats)
        .filter(stat => stat.ignoredMovies > 0 || stat.ignoredShows > 0)
        .sort((a, b) => {
            const totalA = a.ignoredMovies + a.ignoredShows;
            const totalB = b.ignoredMovies + b.ignoredShows;
            return totalB - totalA;
        });

    // Best Source Selections data
    const bestSourceSelectionsData = getMetricValuesWithLabels('playarr_best_source_selections_total');
    const bestSourceSelectionsByProvider = {};
    bestSourceSelectionsData.forEach(item => {
        const providerId = item.provider_id || 'unknown';
        if (!bestSourceSelectionsByProvider[providerId]) {
            bestSourceSelectionsByProvider[providerId] = 0;
        }
        bestSourceSelectionsByProvider[providerId] += item.value;
    });
    const bestSourceSelectionsChartData = Object.entries(bestSourceSelectionsByProvider)
        .map(([providerId, value]) => ({ providerId, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10); // Top 10 providers
    const totalBestSourceSelections = getTotalForMetric('playarr_best_source_selections_total');

    // Best Source Selection Duration data (for average calculation)
    const bestSourceDurationSum = getMetricValue('playarr_best_source_selection_duration_seconds_sum');
    const bestSourceDurationCount = getMetricValue('playarr_best_source_selection_duration_seconds_count');
    const avgBestSourceDuration = bestSourceDurationCount > 0 
        ? (bestSourceDurationSum / bestSourceDurationCount).toFixed(3) 
        : 0;

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error" sx={{ mb: 2 }} action={
                    <Button color="inherit" size="small" onClick={handleRefresh}>
                        Retry
                    </Button>
                }>
                    {error}
                </Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            {/* Header with refresh button */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 3 }}>
                <Button
                    variant="outlined"
                    startIcon={refreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
                    onClick={handleRefresh}
                    disabled={refreshing}
                >
                    Refresh
                </Button>
            </Box>

            {/* Summary Cards */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <PeopleIcon color="primary" sx={{ mr: 1, fontSize: 40 }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(activeUsers)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Active Users
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <MovieIcon sx={{ mr: 1, fontSize: 40, color: theme.palette.warning.main }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(totalMovies)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Movies
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <TvIcon sx={{ mr: 1, fontSize: 40, color: theme.palette.info.main }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(totalTVShows)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        TV Shows
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <PlayIcon sx={{ mr: 1, fontSize: 40, color: theme.palette.info.main }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(totalEpisodes)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Total Episodes
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <TvIcon sx={{ mr: 1, fontSize: 40, color: '#9c27b0' }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(totalChannels)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Total Channels
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                    <Card elevation={3}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                <StarIcon sx={{ mr: 1, fontSize: 40, color: theme.palette.success.main }} />
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 600 }}>
                                        {formatNumber(totalBestSourceSelections)}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Best Source Selections
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>


            {/* First Row: Providers, Provider Titles, Ignored Titles */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                {providerStatsArray.length > 0 && (
                    <Grid item xs={12} md={4}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Providers" />
                            <CardContent>
                                <TableContainer>
                                    <Table>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Provider ID</TableCell>
                                                <TableCell align="right">Expiration Days</TableCell>
                                                <TableCell align="center">Status</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {providerStatsArray.map((provider) => {
                                                const expirationDays = provider.expirationDays;
                                                let expirationDisplay = 'N/A';
                                                let expirationColor = 'default';
                                                
                                                if (expirationDays !== null && expirationDays !== undefined) {
                                                    if (expirationDays < 0) {
                                                        expirationDisplay = `${Math.abs(expirationDays)} days ago`;
                                                        expirationColor = 'error';
                                                    } else if (expirationDays <= 7) {
                                                        expirationDisplay = `${expirationDays} days`;
                                                        expirationColor = 'warning';
                                                    } else {
                                                        expirationDisplay = `${expirationDays} days`;
                                                        expirationColor = 'default';
                                                    }
                                                }
                                                
                                                return (
                                                    <TableRow key={provider.providerId}>
                                                        <TableCell component="th" scope="row">
                                                            {provider.providerId}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {expirationDays !== null && expirationDays !== undefined ? (
                                                                <Chip
                                                                    label={expirationDisplay}
                                                                    color={expirationColor}
                                                                    size="small"
                                                                />
                                                            ) : (
                                                                <Typography variant="body2" color="text.secondary">
                                                                    {expirationDisplay}
                                                                </Typography>
                                                            )}
                                                        </TableCell>
                                                        <TableCell align="center">
                                                            <Chip
                                                                label={provider.active ? 'Active' : 'Inactive'}
                                                                color={provider.active ? 'success' : 'default'}
                                                                size="small"
                                                            />
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
                {providerStatsArray.length > 0 && (
                    <Grid item xs={12} md={4}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Provider Titles" />
                            <CardContent>
                                <Box sx={{ height: 300 }}>
                                    <Bar
                                        data={transformStackedBarChartData(
                                            providerStatsArray,
                                            'providerId',
                                            [
                                                { key: 'movies', label: 'Movies', color: getMediaTypeColors('movies', theme).main },
                                                { key: 'shows', label: 'Shows', color: getMediaTypeColors('tvshows', theme).main },
                                                { key: 'channels', label: 'Channels', color: getMediaTypeColors('live', theme).main },
                                            ]
                                        )}
                                        options={getBarChartOptions(theme, 'providerId', false, true)}
                                    />
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
                {ignoredStatsArray.length > 0 && (
                    <Grid item xs={12} md={4}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Ignored Provider Titles" />
                            <CardContent>
                                <Box sx={{ height: 300 }}>
                                    <Bar
                                        data={transformStackedBarChartData(
                                            ignoredStatsArray,
                                            'providerId',
                                            [
                                                { key: 'ignoredMovies', label: 'Ignored Movies', color: getMediaTypeColors('movies', theme).main },
                                                { key: 'ignoredShows', label: 'Ignored Shows', color: getMediaTypeColors('tvshows', theme).main },
                                            ]
                                        )}
                                        options={getBarChartOptions(theme, 'providerId', false, true)}
                                    />
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>

            {/* Second Row: Job Executions, Stream Requests, Best Source Selections */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                {jobExecutionsChartData.length > 0 && (
                    <Grid item xs={12} md={4}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Job Executions" />
                            <CardContent>
                                <Box sx={{ height: 300 }}>
                                    <Bar
                                        data={transformStackedBarChartData(
                                            jobExecutionsChartData,
                                            'jobType',
                                            [
                                                { key: 'success', label: 'Success', color: '#4caf50' },
                                                { key: 'failure', label: 'Failure', color: '#f44336' },
                                            ]
                                        )}
                                        options={getBarChartOptions(theme, 'jobType', false, true)}
                                    />
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
                <Grid item xs={12} md={4}>
                    <Card elevation={3} sx={{ height: '100%' }}>
                        <CardHeader title="Stream Requests by User" />
                        <CardContent>
                            {streamRequestsChartData.length > 0 ? (
                                <Box sx={{ height: 300 }}>
                                    <Bar
                                        data={transformBarChartData(
                                            streamRequestsChartData,
                                            'user',
                                            'value',
                                            '#0088FE',
                                            'Requests'
                                        )}
                                        options={getBarChartOptions(theme, 'user', false)}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        No stream request data available
                                    </Typography>
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Card elevation={3} sx={{ height: '100%' }}>
                        <CardHeader 
                            title="Best Source Selections by Provider"
                            subheader={totalBestSourceSelections > 0 && avgBestSourceDuration > 0 
                                ? `Total: ${formatNumber(totalBestSourceSelections)} selections | Avg Duration: ${avgBestSourceDuration}s`
                                : `Total: ${formatNumber(totalBestSourceSelections)} selections`
                            }
                        />
                        <CardContent>
                            {bestSourceSelectionsChartData.length > 0 ? (
                                <Box sx={{ height: 300 }}>
                                    <Bar
                                        data={transformBarChartData(
                                            bestSourceSelectionsChartData,
                                            'providerId',
                                            'value',
                                            '#00C49F',
                                            'Selections'
                                        )}
                                        options={getBarChartOptions(theme, 'providerId', false)}
                                    />
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        No best source selection data available
                                    </Typography>
                                </Box>
                            )}
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>


            {/* Empty state */}
            {!loading && !error && activeUsers === 0 && totalTitles === 0 && totalChannels === 0 && totalEpisodes === 0 && totalBestSourceSelections === 0 && (
                <Alert severity="info">
                    No metrics data available. Metrics will appear here once data is collected.
                </Alert>
            )}
        </Box>
    );
};

export default HomePage;

