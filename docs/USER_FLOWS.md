# Playarr User Flows

## Overview

This document outlines step-by-step user workflows for common tasks in Playarr, from initial setup to managing providers, browsing content, and accessing content through various clients.

## Table of Contents

1. [Initial Setup Flow](#initial-setup-flow)
2. [Provider Management Flow](#provider-management-flow)
3. [Content Browsing Flow](#content-browsing-flow)
4. [Watchlist Management Flow](#watchlist-management-flow)
5. [Client Access Flow](#client-access-flow)
6. [User Management Flow (Admin Only)](#user-management-flow-admin-only)
7. [Settings Management Flow](#settings-management-flow)
8. [Troubleshooting Flow](#troubleshooting-flow)

---

## Initial Setup Flow

### 1. First-Time Access

1. **Deploy Playarr** (see [Deployment Guide](DEPLOYMENT.md))
2. **Access Web UI**: Open `http://localhost:3000` (or your configured port)
3. **Login**: Use default admin credentials:
   - Username: `admin` (or `DEFAULT_ADMIN_USERNAME` if configured)
   - Password: Set via `DEFAULT_ADMIN_PASSWORD` environment variable

### 2. Initial Configuration

1. **Configure MongoDB** (if not already configured)
   - Go to Settings → General
   - Verify MongoDB connection

2. **Add TMDB API Token** (optional but recommended)
   - Go to Settings → General
   - Enter your TMDB API token
   - Get token from [TMDB](https://www.themoviedb.org/settings/api)

3. **Add IPTV Providers**
   - Go to Settings → IPTV Providers
   - Click "Add Provider"
   - Fill in provider details:
     - Provider ID (unique identifier)
     - Provider Type (AGTV or Xtream)
     - API URL
     - Username and Password
     - Priority (lower number = higher priority)
   - Enable the provider
   - Save

4. **Wait for Initial Sync**
   - Go to Settings → Jobs
   - Monitor job execution status
   - First sync may take some time depending on provider size

## Provider Management Flow

### Adding a New Provider

1. Navigate to **Settings → IPTV Providers**
2. Click **"Add Provider"**
3. Fill in provider configuration:
   - **ID**: Unique identifier for the provider
   - **Type**: Select "AGTV" or "Xtream"
   - **Enabled**: Toggle to enable/disable
   - **Priority**: Set priority (lower = higher priority)
   - **API URL**: Base URL for provider API
   - **Username/Password**: Provider credentials
   - **Stream URLs**: Array of stream URLs (optional)
   - **Cleanup Rules**: Regex patterns for title cleanup (optional)
   - **Rate Limiting**: Configure API rate limits
4. Click **"Save"**
5. Provider will be processed in the next scheduled job run

### Editing a Provider

1. Navigate to **Settings → IPTV Providers**
2. Click on the provider you want to edit
3. Modify settings as needed
4. Click **"Save"**
5. Changes take effect on next job run

### Disabling a Provider

1. Navigate to **Settings → IPTV Providers**
2. Find the provider
3. Toggle **"Enabled"** to off
4. Provider will be skipped in future job runs
5. Existing content remains in database

### Changing Provider Priority

1. Navigate to **Settings → IPTV Providers**
2. Find the provider
3. Change the **Priority** value (lower = higher priority)
4. Save changes
5. Priority affects content deduplication (higher priority content takes precedence)

## Content Browsing Flow

### Browsing Content

1. **Navigate to Home** page
2. **Select Content Type**: Choose "Movies" or "TV Shows"
3. **Browse**: Scroll through available content
4. **Search**: Use search bar to find specific titles
5. **Filter**: Use filters to narrow down results:
   - Year range
   - Starts with letter
   - Watchlist status

### Viewing Title Details

1. Click on a title from the list
2. View detailed information:
   - Title and description
   - Poster and backdrop
   - Genres
   - Release date
   - Cast and crew
   - Available streams
3. **Add to Watchlist**: Click watchlist button to add/remove from watchlist

## Watchlist Management Flow

### Adding Titles to Watchlist

1. **Browse Content**: Navigate to Home and browse movies or TV shows
2. **Select Title**: Click on a title to view details
3. **Add to Watchlist**: Click the watchlist button (star/bookmark icon)
4. Title is now in your watchlist

### Bulk Watchlist Operations

1. **Browse Content**: Navigate to Home
2. **Select Multiple Titles**: Use checkboxes or bulk selection
3. **Bulk Add/Remove**: Use bulk action buttons
4. Multiple titles updated at once

### Viewing Watchlist

1. Navigate to Home
2. **Filter by Watchlist**: Use "In Watchlist" filter
3. Only titles in your watchlist are displayed

## Client Access Flow

### Stremio Integration

1. **Get Addon URL**: 
   - Go to Profile page
   - Copy the Stremio Manifest URL
2. **Add to Stremio**:
   - Open Stremio
   - Go to Addons
   - Click "Add Addon"
   - Paste the Manifest URL
3. **Access Content**: All movies and TV shows from your watchlist appear in Stremio

### M3U8 Playlist Access

1. **Get API Key**: 
   - Go to Profile page
   - Copy your API key
2. **Access Playlist**:
   - Use your API key to access M3U8 playlist endpoints
   - Only titles in your watchlist are included
3. **Add to Player**: Import playlist URL into your M3U8-compatible player

### Xtream Code API Access

1. **Get Credentials**:
   - Go to Profile page
   - Note your username and API key
2. **Configure Client**:
   - Use your Playarr URL
   - Enter username and API key (as password)
   - Use standard Xtream Code API format
3. **Access Content**: Only titles in your watchlist are available

### Strmarr Integration (Emby/Jellyfin/Kodi)

1. **Get Configuration**:
   - Go to Profile page
   - Find Strmarr section
   - Copy base URL and API key
2. **Set Up Strmarr**:
   - Follow Docker setup instructions in profile
   - Configure Strmarr with Playarr URL and API key
3. **Sync Content**:
   - Strmarr generates STRM files for titles in your watchlist
   - Media servers scan and display content as local media

## User Management Flow (Admin Only)

### Creating a New User

1. Navigate to **Settings → Users**
2. Click **"Add User"**
3. Fill in user details:
   - Username
   - Password
   - Role (Admin or User)
4. Click **"Save"**
5. User can now login and manage their own watchlist

### Managing Users

1. Navigate to **Settings → Users**
2. View list of all users
3. **Edit User**: Click on user to modify details
4. **Delete User**: Remove user account (admin only)
5. **Reset Password**: Change user password

## Settings Management Flow

### General Settings

1. Navigate to **Settings → General**
2. Configure:
   - TMDB API Token
   - TMDB API Rate Limits
   - Other global settings
3. Click **"Save"**

### Job Management

1. Navigate to **Settings → Jobs**
2. View job execution history
3. Monitor job status:
   - Last run time
   - Success/failure status
   - Execution duration
4. View job logs for troubleshooting

### Logs

1. Navigate to **Settings → Logs**
2. View application logs
3. Filter by log level (debug, info, error)
4. Search logs for specific events

## Troubleshooting Flow

### Content Not Appearing

1. **Check Provider Status**:
   - Go to Settings → IPTV Providers
   - Verify provider is enabled
   - Check provider configuration
2. **Check Job Status**:
   - Go to Settings → Jobs
   - Verify jobs are running successfully
   - Check for errors in job logs
3. **Check System Health**:
   - View system health monitor
   - Check MongoDB connection
   - Verify cache directory access

### Client Access Issues

1. **Verify Credentials**:
   - Check API key in Profile
   - Verify username is correct
2. **Check Watchlist**:
   - Ensure titles are in your watchlist
   - Only watchlist titles appear in clients
3. **Check Logs**:
   - Review application logs
   - Look for authentication errors
   - Check for API errors

