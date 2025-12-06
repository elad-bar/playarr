import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import TitleDetailsDialog from '../components/titles/TitleDetailsDialog';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedTitle, fetchTitleDetails, addToWatchlist, removeFromWatchlist } from '../store/slices/titlesSlice';

/**
 * TitleDetailsPage component
 * Handles URL-based navigation for title details with history support
 * URL format: /media/vod/:type/:titleId?nav=type_titleId&nav=type_titleId
 */
const TitleDetailsPage = () => {
  const { type, titleId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { selectedTitle, loading } = useSelector(state => state.titles);
  const [titleKey, setTitleKey] = useState(null);

  // Parse navigation history from query params
  const navHistory = searchParams.getAll('nav');

  // Construct title key from URL params
  useEffect(() => {
    if (type && titleId) {
      const key = `${type}-${titleId}`;
      setTitleKey(key);
      
      // Fetch title details if not already loaded or if it's a different title
      if (!selectedTitle || selectedTitle.key !== key) {
        dispatch(setSelectedTitle({ key }));
        dispatch(fetchTitleDetails(key));
      }
    }
  }, [type, titleId, dispatch, selectedTitle]);

  // Handle dialog close - navigate back through history
  const handleClose = () => {
    if (navHistory.length > 0) {
      // Pop the last item from history
      const newHistory = [...navHistory];
      const lastNav = newHistory.pop();
      
      // Parse the last nav item (format: type_titleId)
      const [navType, navTitleId] = lastNav.split('_');
      
      // Build new URL with remaining history
      const newSearchParams = new URLSearchParams();
      newHistory.forEach(nav => newSearchParams.append('nav', nav));
      
      const newPath = `/media/vod/${navType}/${navTitleId}`;
      const newQuery = newSearchParams.toString();
      navigate(newQuery ? `${newPath}?${newQuery}` : newPath);
    } else {
      // No history, go back to VOD page
      navigate('/media/vod');
    }
  };

  // Handle similar title click - add current title to history and navigate to new title
  const handleSimilarTitleClick = (newTitle) => {
    if (!titleKey) return;
    
    // Handle both string (title_key) and object formats
    const titleKeyToUse = typeof newTitle === 'string' ? newTitle : newTitle.key;
    if (!titleKeyToUse) {
      console.error('Invalid title key in similar title:', newTitle);
      return;
    }
    
    // Parse new title key (format: type-titleId)
    const [newType, newTitleId] = titleKeyToUse.split('-');
    if (!newType || !newTitleId) {
      console.error('Invalid title key format:', titleKeyToUse);
      return;
    }
    
    // Add current title to history (format: type_titleId for URL)
    const currentNav = titleKey.replace('-', '_');
    const newHistory = [...navHistory, currentNav];
    
    // Build new URL
    const newSearchParams = new URLSearchParams();
    newHistory.forEach(nav => newSearchParams.append('nav', nav));
    
    const newPath = `/media/vod/${newType}/${newTitleId}`;
    const newQuery = newSearchParams.toString();
    navigate(newQuery ? `${newPath}?${newQuery}` : newPath);
  };

  // Handle watchlist toggle
  const handleWatchlistToggle = useCallback(async () => {
    if (!selectedTitle) return;
    
    try {
      if (selectedTitle.watchlist) {
        await dispatch(removeFromWatchlist(selectedTitle.key)).unwrap();
      } else {
        await dispatch(addToWatchlist(selectedTitle.key)).unwrap();
      }
    } catch (error) {
      console.error('Failed to update watchlist:', error);
    }
  }, [selectedTitle, dispatch]);

  if (loading || !selectedTitle) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <TitleDetailsDialog
      open={true}
      title={selectedTitle}
      onClose={handleClose}
      onWatchlistToggle={handleWatchlistToggle}
      onSimilarTitleClick={handleSimilarTitleClick}
    />
  );
};

export default TitleDetailsPage;

