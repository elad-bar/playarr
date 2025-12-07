import React, { useEffect, useState, useRef } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  CircularProgress, 
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { socketService } from '../../services/socket';
import axiosInstance from '../../config/axios';
import { API_ENDPOINTS } from '../../config/api';

/**
 * Available log levels (simplified to 3 levels)
 */
const LOG_LEVELS = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' }
];

/**
 * Settings Logger component
 * Displays real-time logs streamed via WebSocket
 * Maintains up to 1000 lines from current run
 * Allows changing log level dynamically
 */
const SettingsLogger = () => {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logLevel, setLogLevel] = useState('info');
  const [changingLevel, setChangingLevel] = useState(false);
  const logContainerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const MAX_LINES = 1000;

  /**
   * Get color for log level
   * @param {string} logLine - Log line text
   * @returns {string} Color code
   */
  const getLogColor = (logLine) => {
    const upperLine = logLine.toUpperCase();
    if (upperLine.includes('ERROR:')) {
      return '#ff6b6b'; // Red
    } else if (upperLine.includes('WARN:')) {
      return '#ffa726'; // Orange
    } else if (upperLine.includes('INFO:')) {
      return '#42a5f5'; // Blue
    } else if (upperLine.includes('DEBUG:')) {
      return '#42a5f5'; // Blue (same as info, since debug maps to info)
    }
    return '#d4d4d4'; // Default light gray
  };

  // Fetch current log level on mount
  useEffect(() => {
    const fetchLogLevel = async () => {
      try {
        const response = await axiosInstance.get(API_ENDPOINTS.settings.logStreamLevel);
        setLogLevel(response.data.level || 'info');
      } catch (error) {
        console.error('Failed to fetch log level:', error);
        // Use default 'info' if fetch fails
        setLogLevel('info');
      }
    };
    fetchLogLevel();
  }, []);

  useEffect(() => {
    if (!socketService.socket) {
      setError('WebSocket not connected');
      setLoading(false);
      return;
    }

    const socket = socketService.socket;
    setConnected(socket.connected);

    // Request initial log buffer
    const handleConnect = () => {
      setConnected(true);
      setLoading(true);
      socket.emit('log:subscribe');
    };

    // Receive initial log buffer
    const handleLogBuffer = (data) => {
      // Reverse the array so newest logs appear first
      const reversedLines = [...(data.lines || [])].reverse();
      setLogs(reversedLines);
      if (data.level) {
        setLogLevel(data.level);
      }
      setLoading(false);
      setError(null);
      shouldAutoScrollRef.current = true;
    };

    // Receive new log messages
    const handleLogMessage = (data) => {
      setLogs(prevLogs => {
        // Prepend new log (newest first)
        const newLogs = [data.line, ...prevLogs];
        // Keep only first 1000 lines (newest)
        if (newLogs.length > MAX_LINES) {
          return newLogs.slice(0, MAX_LINES);
        }
        return newLogs;
      });
      shouldAutoScrollRef.current = true;
    };

    // Handle log level changes
    const handleLevelChanged = (data) => {
      setLogLevel(data.level);
      // If buffer is included, update logs with filtered buffer (newest first)
      if (data.lines) {
        const reversedLines = [...data.lines].reverse();
        setLogs(reversedLines);
        shouldAutoScrollRef.current = true;
      }
      setChangingLevel(false);
    };

    // Handle errors
    const handleError = (data) => {
      setError(data.message);
      setChangingLevel(false);
    };

    // Handle disconnect
    const handleDisconnect = () => {
      setConnected(false);
      setError('WebSocket disconnected');
    };

    // Register event listeners
    if (socket.connected) {
      handleConnect();
    } else {
      socket.on('connect', handleConnect);
    }

    socket.on('log:buffer', handleLogBuffer);
    socket.on('log:message', handleLogMessage);
    socket.on('log:level_changed', handleLevelChanged);
    socket.on('log:error', handleError);
    socket.on('disconnect', handleDisconnect);

    // Cleanup
    return () => {
      socket.off('connect', handleConnect);
      socket.off('log:buffer', handleLogBuffer);
      socket.off('log:message', handleLogMessage);
      socket.off('log:level_changed', handleLevelChanged);
      socket.off('log:error', handleError);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  // Auto-scroll to top when new logs arrive (newest first)
  useEffect(() => {
    if (shouldAutoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [logs]);

  // Handle manual scroll to detect if user scrolled away from top
  const handleScroll = () => {
    if (logContainerRef.current) {
      const { scrollTop } = logContainerRef.current;
      // If user scrolled more than 10px from top, don't auto-scroll
      shouldAutoScrollRef.current = scrollTop <= 10;
    }
  };

  // Handle log level change
  const handleLevelChange = async (event) => {
    const newLevel = event.target.value;
    setChangingLevel(true);
    setError(null);

    try {
      // Update via WebSocket for immediate effect
      if (socketService.socket && socketService.socket.connected) {
        socketService.socket.emit('log:set_level', { level: newLevel });
      }

      // Also update via REST API for persistence
      await axiosInstance.post(API_ENDPOINTS.settings.logStreamLevel, { level: newLevel });
      
      // Optimistically update UI (will be confirmed by WebSocket event)
      setLogLevel(newLevel);
    } catch (error) {
      setError(`Failed to change log level: ${error.message}`);
      setChangingLevel(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            Real-time logs from the current application run (max {MAX_LINES} lines)
          </Typography>
        </Box>
        
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="log-level-label">Log Level</InputLabel>
          <Select
            labelId="log-level-label"
            id="log-level-select"
            value={logLevel}
            label="Log Level"
            onChange={handleLevelChange}
            disabled={changingLevel || !connected}
          >
            {LOG_LEVELS.map((level) => (
              <MenuItem key={level.value} value={level.value}>
                {level.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!connected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Connecting to log stream...
        </Alert>
      )}

      <Paper
        sx={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: '#1e1e1e',
          color: '#d4d4d4'
        }}
      >
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            ref={logContainerRef}
            onScroll={handleScroll}
            sx={{
              flex: 1,
              overflow: 'auto',
              p: 2,
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {logs.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No logs available. Logs will appear here as the application runs.
              </Typography>
            ) : (
              logs.map((log, index) => {
                const logColor = getLogColor(log);
                return (
                  <Box 
                    key={index} 
                    sx={{ 
                      mb: 0.5,
                      color: logColor,
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)'
                      }
                    }}
                  >
                    {log}
                  </Box>
                );
              })
            )}
          </Box>
        )}
      </Paper>

      {logs.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          {logs.length} line{logs.length !== 1 ? 's' : ''} displayed | Level: {logLevel}
        </Typography>
      )}
    </Box>
  );
};

export default SettingsLogger;

