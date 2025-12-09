import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    Button,
    Grid,
    Divider,
    IconButton,
    Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';
import { intervalToDuration, formatDuration } from 'date-fns';
import yaml from 'js-yaml';

/**
 * Parse interval string (e.g., "1h", "6h", "1m") to milliseconds
 */
const parseInterval = (intervalStr) => {
    if (!intervalStr) return null;
    const match = String(intervalStr).match(/^(\d+)([smhd])?$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = (match[2] || 'ms').toLowerCase();
    const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * (multipliers[unit] || 1);
};

/**
 * Format date for display as accurate relative time (e.g., "6 hours and 4 minutes ago")
 */
const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    try {
        const date = new Date(dateString);
        const now = new Date();
        
        const duration = intervalToDuration({ start: date, end: now });
        const readable = formatDuration(duration);
        
        if (!readable || readable.trim() === '') {
            return 'just now';
        }
        
        return `${readable} ago`;
    } catch (error) {
        return 'Invalid date';
    }
};

/**
 * Calculate and format next execution time
 */
const formatNextExecution = (lastExecution, interval) => {
    if (!interval) {
        return 'Manual trigger only';
    }
    
    const intervalMs = parseInterval(interval);
    if (!intervalMs) {
        return 'N/A';
    }
    
    try {
        const now = new Date();
        let nextExecution;
        
        if (lastExecution) {
            const lastExec = new Date(lastExecution);
            nextExecution = new Date(lastExec.getTime() + intervalMs);
        } else {
            // If never executed, show next execution as now + interval
            nextExecution = new Date(now.getTime() + intervalMs);
        }
        
        // If next execution is in the past (job is overdue), show "overdue"
        if (nextExecution < now) {
            const overdue = intervalToDuration({ start: nextExecution, end: now });
            const overdueReadable = formatDuration(overdue);
            return `Overdue by ${overdueReadable}`;
        }
        
        // Format as "in X hours Y minutes"
        const duration = intervalToDuration({ start: now, end: nextExecution });
        const readable = formatDuration(duration);
        
        if (!readable || readable.trim() === '') {
            return 'now';
        }
        
        return `in ${readable}`;
    } catch (error) {
        return 'N/A';
    }
};

/**
 * Format job result for display
 */
const formatJobResult = (jobName, lastResult) => {
    if (!lastResult) return null;

    try {
        return yaml.dump(lastResult, { 
            indent: 2,
            lineWidth: 0, // Force block style formatting
            noRefs: true,
            skipInvalid: false,
            flowLevel: -1 // Use block style for all levels
        });
    } catch (error) {
        // Fallback to JSON if YAML conversion fails
        return JSON.stringify(lastResult, null, 2);
    }
};

/**
 * Job card component
 */
const JobCard = ({ job, onTrigger, engineReachable }) => {
    const [triggering, setTriggering] = useState(false);
    const [triggerError, setTriggerError] = useState(null);
    const [triggerSuccess, setTriggerSuccess] = useState(false);
    const [aborting, setAborting] = useState(false);
    const [abortError, setAbortError] = useState(null);
    const [abortSuccess, setAbortSuccess] = useState(false);

    /**
     * Handle job trigger
     */
    const handleTrigger = async () => {
        if (!engineReachable) {
            setTriggerError('Engine API is not reachable');
            return;
        }

        setTriggering(true);
        setTriggerError(null);
        setTriggerSuccess(false);

        try {
            await axiosInstance.post(API_ENDPOINTS.triggerJob(job.name));
            setTriggerSuccess(true);
            // Clear success message after 3 seconds
            setTimeout(() => {
                setTriggerSuccess(false);
            }, 3000);
            // Refresh jobs list after a short delay to show updated status
            if (onTrigger) {
                setTimeout(() => {
                    onTrigger();
                }, 1000);
            }
        } catch (err) {
            console.error('Error triggering job:', err);
            const errorMessage = err.response?.data?.error || err.message || 'Failed to trigger job';
            setTriggerError(errorMessage);
        } finally {
            setTriggering(false);
        }
    };

    /**
     * Handle job abort
     */
    const handleAbort = async () => {
        if (!engineReachable) {
            setAbortError('Engine API is not reachable');
            return;
        }

        setAborting(true);
        setAbortError(null);
        setAbortSuccess(false);

        try {
            await axiosInstance.post(API_ENDPOINTS.abortJob(job.name));
            setAbortSuccess(true);
            setTimeout(() => {
                setAbortSuccess(false);
            }, 3000);
            // Refresh jobs list after a short delay to show updated status
            if (onTrigger) {
                setTimeout(() => {
                    onTrigger();
                }, 1000);
            }
        } catch (err) {
            console.error('Error aborting job:', err);
            const errorMessage = err.response?.data?.error || err.message || 'Failed to abort job';
            setAbortError(errorMessage);
        } finally {
            setAborting(false);
        }
    };

    const isRunning = job.status === 'running';

    return (
        <Paper
            elevation={2}
            sx={{
                p: 3,
                mb: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                height: '100%',
                minHeight: '400px'
            }}
        >
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h6" sx={{ flex: 1 }}>
                        {job.name}
                    </Typography>
                    {/* Show abort button if job is running */}
                    {isRunning && (
                        <Tooltip title="Abort running job">
                            <IconButton
                                onClick={handleAbort}
                                disabled={aborting || !engineReachable}
                                color="error"
                                size="small"
                                sx={{
                                    '&:hover': {
                                        backgroundColor: 'error.light',
                                    },
                                }}
                            >
                                {aborting ? (
                                    <CircularProgress size={20} />
                                ) : (
                                    <StopIcon />
                                )}
                            </IconButton>
                        </Tooltip>
                    )}
                    {/* Show trigger button when not running */}
                    {!isRunning && (
                        <Tooltip title="Trigger job manually">
                            <IconButton
                                onClick={handleTrigger}
                                disabled={triggering || !engineReachable}
                                color="primary"
                                size="small"
                                sx={{
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                {triggering ? (
                                    <CircularProgress size={20} />
                                ) : (
                                    <PlayArrowIcon />
                                )}
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
                {triggerSuccess && (
                    <Alert severity="success" sx={{ mb: 1, py: 0.5 }}>
                        Job triggered successfully
                    </Alert>
                )}
                {abortSuccess && (
                    <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
                        Job abort signal sent
                    </Alert>
                )}
                {triggerError && (
                    <Alert severity="error" sx={{ mb: 1, py: 0.5 }} onClose={() => setTriggerError(null)}>
                        {triggerError}
                    </Alert>
                )}
                {abortError && (
                    <Alert severity="error" sx={{ mb: 1, py: 0.5 }} onClose={() => setAbortError(null)}>
                        {abortError}
                    </Alert>
                )}
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body2" color="text.secondary" paragraph>
                    {job.description}
                </Typography>
            </Box>

            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {job.lastResult && (
                    <Box sx={{ mt: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                        Last Result:
                    </Typography>
                    <Box 
                        component="pre" 
                        sx={{ 
                            fontWeight: 500,
                            fontSize: '0.875rem',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            backgroundColor: 'rgba(0, 0, 0, 0.02)',
                            p: 1,
                            borderRadius: 1,
                            mt: 0.5,
                            mb: 0,
                            overflow: 'auto',
                            flex: 1,
                            minHeight: 0
                        }}
                    >
                        {formatJobResult(job.name, job.lastResult)}
                    </Box>
                    </Box>
                )}
                {job.lastError && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        <Typography variant="body2">
                            <strong>Error:</strong> {job.lastError}
                        </Typography>
                    </Alert>
                )}
            </Box>

            {/* Footer with execution details */}
            <Box sx={{ mt: 'auto', pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                    <span style={{ fontWeight: 500, textTransform: 'capitalize', color: 'inherit' }}>{job.status || 'unknown'}</span> {formatDate(job.lastExecution)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Next Execution: <span style={{ fontWeight: 500, color: 'inherit' }}>{formatNextExecution(job.lastExecution, job.interval)}</span>
                </Typography>
            </Box>
        </Paper>
    );
};

/**
 * SettingsJobs component
 * Displays list of engine jobs with details (job triggering removed)
 */
const SettingsJobs = () => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [engineReachable, setEngineReachable] = useState(true);

    /**
     * Fetch jobs from API
     */
    const fetchJobs = async () => {
        try {
            setError(null);
            // Add cache-busting parameter to ensure fresh request
            const response = await axiosInstance.get(API_ENDPOINTS.jobs, {
                params: { _t: Date.now() }
            });
            setJobs(response.data.jobs || []);
            
            // Check if engine is not reachable (even if status is 200, check the data)
            if (response.data.engineReachable === false) {
                setEngineReachable(false);
                setError(null); // Don't show error, only show warning
            } else {
                setEngineReachable(true);
            }
        } catch (err) {
            console.error('Error fetching jobs:', err);
            
            // Check if error is specifically about engine not being reachable
            // This happens when web-api returns 503 with engineReachable: false
            const responseData = err.response?.data;
            const statusCode = err.response?.status;
            const errorMessage = responseData?.error || err.message;
            
            // Check for engine unreachable conditions:
            // 1. Response explicitly says engineReachable: false
            // 2. Error message mentions engine not reachable
            // 3. Status code is 503 (Service Unavailable) - engine unreachable
            // 4. Status code is 404 (Not found) - might indicate engine/server issue
            // 5. Network errors (ECONNREFUSED, ETIMEDOUT) when trying to reach engine
            const isEngineUnreachable = 
                responseData?.engineReachable === false || 
                errorMessage === 'Engine API is not reachable' ||
                errorMessage?.includes('Engine API') ||
                statusCode === 503 ||
                (statusCode === 404 && errorMessage === 'Not found') ||
                err.code === 'ECONNREFUSED' ||
                err.code === 'ETIMEDOUT';
            
            if (isEngineUnreachable) {
                // Don't show error for engine unreachable - only show warning
                setEngineReachable(false);
                setError(null); // Explicitly clear error
                setJobs(responseData?.jobs || []); // Still show jobs from history if available
            } else {
                // Show error for other failures (but not for engine unreachable)
                setEngineReachable(true); // Assume engine is reachable for other errors
                setError(errorMessage || 'Failed to fetch jobs');
            }
        } finally {
            setLoading(false);
        }
    };

    /**
     * Manual refresh
     */
    const handleRefresh = () => {
        setLoading(true);
        fetchJobs();
    };

    // Clear error when engine becomes unreachable
    useEffect(() => {
        if (!engineReachable) {
            setError(null);
        }
    }, [engineReachable]);

    // Initial fetch and auto-refresh setup
    useEffect(() => {
        fetchJobs();

        // Auto-refresh every 10 seconds
        const interval = setInterval(() => {
            fetchJobs();
        }, 10000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    if (loading && jobs.length === 0) {
        return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, sm: 3 } }}>
                <CircularProgress />
            </Box>
        );
    }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'flex-end' }}>
                <Button
                    variant="contained"
                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
                    onClick={handleRefresh}
                    disabled={loading}
                    sx={{
                        backgroundColor: '#1976d2', // Primary blue
                        color: '#ffffff',
                        '&:hover': {
                            backgroundColor: '#1565c0', // Darker blue
                        },
                    }}
                >
                    Refresh
                </Button>
            </Box>

            {!engineReachable && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    Engine API is not reachable. You can view job history.
                </Alert>
            )}

            {error && engineReachable && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {jobs.length === 0 && engineReachable ? (
                <Typography variant="body2" color="text.secondary">
                    No jobs found.
                </Typography>
            ) : jobs.length > 0 ? (
                <Grid container spacing={2}>
                    {jobs.map((job) => (
                        <Grid item xs={12} sm={6} md={3} key={job.name}>
                            <JobCard 
                                job={job} 
                                onTrigger={fetchJobs}
                                engineReachable={engineReachable}
                            />
                        </Grid>
                    ))}
                </Grid>
            ) : null}
        </Box>
    );
};

export default SettingsJobs;

