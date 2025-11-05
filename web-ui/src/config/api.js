// Add other API-related configuration as needed
export const API_ENDPOINTS = {
    // Titles endpoints
    titles: (mediaType, filters = {}) => {
        const params = new URLSearchParams();
        if (mediaType) params.append('media_type', mediaType);
        if (filters.searchQuery) params.append('search', filters.searchQuery);
        if (filters.yearFilter) params.append('year', filters.yearFilter);
        if (filters.selectedLetter) params.append('starts_with', filters.selectedLetter);
        if (filters.watchlistFilter && filters.watchlistFilter !== 'all') {
            params.append('watchlist', filters.watchlistFilter === 'checked' ? 'true' : 'false');
        }
        if (filters.page) params.append('page', filters.page);
        if (filters.per_page) params.append('per_page', filters.per_page);
        return `/titles${params.toString() ? `?${params.toString()}` : ''}`;
    },
    titleDetails: (titleKey) => `/titles/${titleKey}`,
    watchlist: (titleKey) => `/titles/${titleKey}/watchlist`,
    watchlistStats: `/titles/watchlist`,
    watchlistBulk: `/titles/watchlist/bulk`,

    // Stream endpoints
    streamMovie: (titleId) => `/api/stream/movies/${titleId}`,
    streamShow: (titleId, seasonNumber, episodeNumber) => `/api/stream/tvshows/${titleId}/${seasonNumber}/${episodeNumber}`,

    // Providers endpoints
    providers: `/iptv/providers`,
    providerCategories: (providerId) => `/iptv/providers/${providerId}/categories`,
    providerStatus: (providerId) => `/iptv/providers/${providerId}/status`,

    // TMDB endpoints
    tmdb: {
        apiKey: `/tmdb/api-key`,
        verify: `/tmdb/verify`,
        lists: `/tmdb/lists`,
        listItems: (listId) => `/tmdb/lists/${listId}/items`,
        importList: `/tmdb/lists/import`
    },

    // Stats endpoints
    stats: `/stats`,

    // System endpoints
    healthcheck: `/healthcheck`,

    // Settings endpoints
    settings: {
        tmdbToken: '/settings/tmdb_token',
    },
};
