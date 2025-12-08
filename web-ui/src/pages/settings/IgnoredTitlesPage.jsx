import React, { useState } from 'react';
import { Box } from '@mui/material';
import IgnoredTitlesList from '../../components/settings/ignored-titles/IgnoredTitlesList';

/**
 * Ignored Titles Settings Page
 * Displays all ignored provider titles in a VOD-style grid layout
 */
const IgnoredTitlesPage = () => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
  };

  return (
    <Box>
      <IgnoredTitlesList searchQuery={searchQuery} onSearchChange={handleSearchChange} />
    </Box>
  );
};

export default IgnoredTitlesPage;

