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
    People as PeopleIcon,
    Movie as MovieIcon,
    Tv as TvIcon,
    PlayArrow as PlayIcon,
    Refresh as RefreshIcon,
    Star as StarIcon,
} from '@mui/icons-material';
import {
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

/**
 * Format number with commas
 */
const formatNumber = (num) => {
    if (num === null || num === undefined) return '0';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);
};

/**
 * Statistics page component displaying Prometheus metrics dashboard
 */
const Statistics = () => {
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
            const errorMessage = err.message || 'Failed to load statistics';
            setError(`Failed to load statistics: ${errorMessage}`);
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

    // Error Breakdown data
    const errorData = getMetricValuesWithLabels('playarr_managed_errors_total');
    const errorsByType = {};
    errorData.forEach(item => {
        const errorType = item.error_type || 'unknown';
        if (!errorsByType[errorType]) {
            errorsByType[errorType] = 0;
        }
        errorsByType[errorType] += item.value;
    });
    const errorChartData = Object.entries(errorsByType)
        .map(([errorType, value]) => ({ name: errorType, value }))
        .sort((a, b) => b.value - a.value);

    // Provider Statistics
    const providerTitlesData = getMetricValuesWithLabels('playarr_provider_titles_count');
    const providerChannelsData = getMetricValuesWithLabels('playarr_channels_count');
    const providerActiveData = getMetricValuesWithLabels('playarr_provider_active');
    const providerExpirationDaysData = getMetricValuesWithLabels('playarr_provider_expiration_days');
    
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
        const totalA = a.movies + a.shows;
        const totalB = b.movies + b.shows;
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
                    Statistics Dashboard
                </Typography>
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


            {/* Error Breakdown */}
            {errorChartData.length > 0 && (
                <Card elevation={3} sx={{ mb: 3 }}>
                    <CardHeader title="Error Breakdown" />
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={errorChartData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {errorChartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => formatNumber(value)} />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            {/* Provider Statistics Table and Job Executions Chart */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                {providerStatsArray.length > 0 && (
                    <Grid item xs={12} md={6}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Provider Statistics" />
                            <CardContent>
                                <TableContainer>
                                    <Table>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Provider ID</TableCell>
                                                <TableCell align="right">Movies</TableCell>
                                                <TableCell align="right">Shows</TableCell>
                                                <TableCell align="right">Channels</TableCell>
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
                                                            {formatNumber(provider.movies)}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {formatNumber(provider.shows)}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {formatNumber(provider.channels)}
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
                {jobExecutionsChartData.length > 0 && (
                    <Grid item xs={12} md={6}>
                        <Card elevation={3} sx={{ height: '100%' }}>
                            <CardHeader title="Job Executions" />
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={jobExecutionsChartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="jobType" angle={-45} textAnchor="end" height={100} />
                                        <YAxis />
                                        <Tooltip formatter={(value) => formatNumber(value)} />
                                        <Legend />
                                        <Bar dataKey="success" stackId="a" fill="#00C49F" name="Success" />
                                        <Bar dataKey="failure" stackId="a" fill="#FF8042" name="Failure" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>

            {/* Stream Requests and Best Source Selections Charts */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} md={6}>
                    <Card elevation={3} sx={{ height: '100%' }}>
                        <CardHeader title="Stream Requests by User" />
                        <CardContent>
                            {streamRequestsChartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={streamRequestsChartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="user" angle={-45} textAnchor="end" height={100} />
                                        <YAxis />
                                        <Tooltip formatter={(value) => formatNumber(value)} />
                                        <Legend />
                                        <Bar dataKey="value" fill="#0088FE" name="Requests" />
                                    </BarChart>
                                </ResponsiveContainer>
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
                <Grid item xs={12} md={6}>
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
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={bestSourceSelectionsChartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="providerId" angle={-45} textAnchor="end" height={100} />
                                        <YAxis />
                                        <Tooltip formatter={(value) => formatNumber(value)} />
                                        <Legend />
                                        <Bar dataKey="value" fill="#00C49F" name="Selections" />
                                    </BarChart>
                                </ResponsiveContainer>
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
                    No statistics data available. Metrics will appear here once data is collected.
                </Alert>
            )}
        </Box>
    );
};

export default Statistics;

