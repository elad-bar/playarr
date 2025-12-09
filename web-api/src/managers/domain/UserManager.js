import { BaseDomainManager } from './BaseDomainManager.js';
import { DatabaseCollections, toCollectionName } from '../../config/collections.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { createJWTToken } from '../../utils/jwt.js';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError, AppError } from '../../errors/AppError.js';

/**
 * User manager for handling user operations
 * Matches Python's UserService and AuthenticationManager functionality
 */
class UserManager extends BaseDomainManager {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepo - User repository
   */
  constructor(userRepo) {
    super('UserManager', userRepo);
    this._usersCollection = toCollectionName(DatabaseCollections.USERS);
  }

  /**
   * Initialize user manager (creates indices, ensures default admin user)
   * Matches Python's AuthenticationManager.initialize()
   */
  async initialize() {
    try {
      this.logger.debug('Initializing user manager...');

      // Ensure default admin user exists
      await this._ensureDefaultAdminUser();

      this.logger.info('User manager initialized');
    } catch (error) {
      this.logger.error('Failed initializing user manager:', error);
      throw error;
    }
  }

  /**
   * Ensure default admin user exists
   * Matches Python's AuthenticationManager._ensure_default_admin_user()
   */
  async _ensureDefaultAdminUser() {
    try {
      const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD;

      if (!defaultPassword) {
        this.logger.warn('DEFAULT_ADMIN_PASSWORD not set, skipping default admin user creation');
        return;
      }

      // Check if admin user already exists
      const existingUser = await this.getUserByUsername(defaultUsername);
      if (existingUser) {
        this.logger.info(`Default admin user '${defaultUsername}' already exists`);
        return;
      }

      // Create default admin user with isDefaultAdmin flag
      this.logger.info(`Creating default admin user '${defaultUsername}'`);
      const user = await this.createUser(
        defaultUsername,
        'Admin',
        'User',
        defaultPassword,
        'admin'
      );
      // Mark as default admin
      user.isDefaultAdmin = true;
      // Update in storage
      await this._repository.updateOne(
        { username: defaultUsername },
        { $set: { isDefaultAdmin: true } }
      );
      this.logger.info(`Default admin user '${defaultUsername}' created successfully`);
    } catch (error) {
      this.logger.error('Failed ensuring default admin user:', error);
      throw error;
    }
  }

  /**
   * Generate an 8-character alphanumeric API key
   * Matches Python's _generate_api_key()
   */
  _generateApiKey() {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let apiKey = '';
    for (let i = 0; i < 8; i++) {
      apiKey += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return apiKey;
  }

  /**
   * Convert user to public format (remove password_hash, _id, and watchlist)
   * Ensures created_at and updated_at are always present and in ISO string format
   * Matches Python's user_to_public() behavior with ISO timestamp serialization
   * Python UserPublic model includes: username, first_name, last_name, api_key, status, role, created_at, updated_at
   */
  _userToPublic(user) {
    // Explicitly include only the fields that Python UserPublic includes
    // Exclude: password_hash, _id, watchlist
    const { password_hash, _id, watchlist, ...userPublic } = user;
    
    // Convert timestamps to ISO strings matching Python's format exactly
    // Python's datetime serializes to ISO format like "2025-11-03T08:55:01.671000" (no Z, microseconds)
    // JavaScript's toISOString() returns "2025-11-03T08:55:01.671Z" (with Z, milliseconds)
    // We need to normalize to match Python format
    const convertToISO = (value) => {
      let date;
      
      if (!value) {
        date = new Date();
      } else if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string') {
        // If it's already an ISO string (possibly from MongoDB or Python format)
        // Check if it matches Python format (no Z) or JS format (with Z)
        if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
          // Already an ISO-like string
          // If it ends with Z, remove it to match Python format
          if (value.endsWith('Z')) {
            return value.slice(0, -1);
          }
          // If it already matches Python format (no Z), return as-is
          return value;
        }
        // Try to parse as date
        try {
          date = new Date(value);
          if (isNaN(date.getTime())) {
            date = new Date();
          }
        } catch (e) {
          date = new Date();
        }
      } else {
        date = new Date();
      }
      
      // Convert to ISO string and remove 'Z' to match Python format
      let isoString = date.toISOString();
      
      // Remove 'Z' suffix to match Python's format (Python uses UTC but doesn't include Z)
      if (isoString.endsWith('Z')) {
        isoString = isoString.slice(0, -1);
      }
      
      // Python uses microseconds (6 digits) while JS has milliseconds (3 digits)
      // Pad milliseconds to 6 digits to match Python's format exactly
      // Format: "2025-11-03T08:55:01.671" -> "2025-11-03T08:55:01.671000"
      const match = isoString.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})(.*)$/);
      if (match) {
        const [, dateTime, milliseconds, rest] = match;
        // Pad milliseconds to 6 digits (microseconds)
        const microseconds = milliseconds.padEnd(6, '0');
        isoString = `${dateTime}.${microseconds}${rest}`;
      }
      
      return isoString;
    };

    // Build public user object matching Python's UserPublic fields EXACTLY
    // Python UserPublic: username, first_name, last_name, api_key, status, role, created_at, updated_at
    // NO watchlist field in UserPublic
    const publicUser = {
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      api_key: user.api_key || '',
      status: user.status || 'active',
      role: user.role || 'user',
      created_at: convertToISO(user.created_at),
      updated_at: convertToISO(user.updated_at),
    };
    
    return publicUser;
  }

  /**
   * Get user by username (from database)
   * Matches Python's get_user_by_username()
   */
  async getUserByUsername(username) {
    // Query database (database service handles caching internally)
    try {
      const userData = await this._repository.findOneByQuery({ username });
      
      if (userData) {
        // Remove any MongoDB _id if present
        const { _id, ...user } = userData;
        
        // Mark default admin user
        const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
        if (user.username === defaultAdminUsername) {
          user.isDefaultAdmin = true;
        }
        
        return user;
      }
    } catch (error) {
      this.logger.error(`Failed getting user by username ${username}:`, error);
    }

    return null;
  }

  /**
   * Get user by API key (from database)
   * Matches Python's get_user_by_api_key()
   */
  async getUserByApiKey(apiKey) {
    // Query database (database service handles caching internally)
    try {
      const userData = await this._repository.findOneByQuery({ api_key: apiKey });
      
      if (userData) {
        const { _id, ...user } = userData;
        
        // Mark default admin user
        const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
        if (user.username === defaultAdminUsername) {
          user.isDefaultAdmin = true;
        }
        
        if (user.status === 'active') {
          return user;
        }
      }
    } catch (error) {
      this.logger.error('Failed getting user by API key:', error);
    }

    return null;
  }

  /**
   * Get all users
   * Returns format matching Python: {users: [...]}
   * @returns {Promise<{users: Array}>} Users object
   * @throws {AppError} If an error occurs
   */
  async getAllUsers() {
    try {
      const usersData = await this._repository.findByQuery({});
      
      if (!usersData) {
        return { users: [] };
      }

      // Convert to public format
      const usersPublic = [];
      const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      for (const userData of usersData) {
        const { _id, ...user } = userData;
        // Mark default admin user
        if (user.username === defaultAdminUsername) {
          user.isDefaultAdmin = true;
        }
        usersPublic.push(this._userToPublic(user));
      }
      
      return { users: usersPublic };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Failed getting all users:', error);
      throw new AppError('Failed to get users', 500);
    }
  }


  /**
   * Get a specific user by username
   * @param {string} username - Username
   * @returns {Promise<Object>} User public object
   * @throws {NotFoundError} If user not found
   * @throws {AppError} If an error occurs
   */
  async getUser(username) {
    try {
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const userPublic = this._userToPublic(user);
      return userPublic;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed getting user ${username}:`, error);
      throw new AppError('Failed to get user', 500);
    }
  }

  /**
   * Delete user (deactivate by setting status to inactive)
   * Cannot delete default admin user
   * @param {string} username - Username
   * @returns {Promise<Object>} Updated user public object
   * @throws {ForbiddenError} If trying to delete default admin user
   * @throws {AppError} If an error occurs
   */
  async deleteUser(username) {
    try {
      // Prevent deletion of default admin user
      const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      if (username === defaultAdminUsername) {
        throw new ForbiddenError('Cannot delete default admin user');
      }

      return await this.updateUser(username, { status: 'inactive' });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed deleting user ${username}:`, error);
      throw new AppError('Failed to delete user', 500);
    }
  }

  /**
   * Authenticate a user by username and password
   * Matches Python's authenticate_user()
   */
  async authenticateUser(username, password) {
    const user = await this.getUserByUsername(username);

    if (!user) {
      return null;
    }

    if (user.status !== 'active') {
      return null;
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return null;
    }

    return user;
  }

  /**
   * Create a new user
   * Matches Python's create_user()
   */
  async createUser(username, firstName, lastName, password, role) {
    try {
      // Check if username already exists
      const existingUser = await this.getUserByUsername(username);
      if (existingUser) {
        throw new Error(`User '${username}' already exists`);
      }

      // Generate API key
      const apiKey = this._generateApiKey();

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user object
      const now = new Date();
      const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      const user = {
        username,
        first_name: firstName,
        last_name: lastName,
        password_hash: passwordHash,
        api_key: apiKey,
        watchlist: {
          movies: [],
          tvshows: [],
          live: []
        },
        status: 'active',
        role: role || 'user',
        created_at: now,
        updated_at: now,
        createdAt: now,
        lastUpdated: now,
        isDefaultAdmin: username === defaultAdminUsername,
      };

      // Save to database
      await this._repository.insertOne(user);

      return user;
    } catch (error) {
      this.logger.error('Failed creating user:', error);
      throw error;
    }
  }

  /**
   * Update an existing user
   * Matches Python's update_user()
   * @param {string} username - Username
   * @param {Object} updates - Update fields
   * @returns {Promise<Object>} Updated user public object
   * @throws {NotFoundError} If user not found
   * @throws {ValidationError} If validation fails
   * @throws {AppError} If an error occurs
   */
  async updateUser(username, updates) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Validate status
      if (updates.status !== undefined && !['active', 'inactive'].includes(updates.status)) {
        throw new ValidationError("Invalid status. Must be 'active' or 'inactive'");
      }

      // Validate role
      if (updates.role !== undefined && !['admin', 'user'].includes(updates.role)) {
        throw new ValidationError("Invalid role. Must be 'admin' or 'user'");
      }

      const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      const isDefaultAdmin = username === defaultAdminUsername;

      // Update fields
      const updateData = {};
      if (updates.first_name !== undefined) {
        user.first_name = updates.first_name;
        updateData.first_name = updates.first_name;
      }
      if (updates.last_name !== undefined) {
        user.last_name = updates.last_name;
        updateData.last_name = updates.last_name;
      }
      if (updates.status !== undefined) {
        user.status = updates.status;
        updateData.status = updates.status;
      }
      // Silently ignore role changes for default admin
      if (updates.role !== undefined && !isDefaultAdmin) {
        user.role = updates.role;
        updateData.role = updates.role;
      }

      const now = new Date();
      user.updated_at = now;
      updateData.updated_at = now;

      // Update database
      await this._repository.updateOne(
        { username },
        { $set: updateData }
      );

      const userPublic = this._userToPublic(user);
      return userPublic;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed updating user ${username}:`, error);
      throw new AppError('Failed to update user', 500);
    }
  }

  /**
   * Create user with response format
   * @param {string} username - Username
   * @param {string} firstName - First name
   * @param {string} lastName - Last name
   * @param {string} password - Password
   * @param {string} [role] - Role ('admin' or 'user')
   * @returns {Promise<Object>} User public object
   * @throws {ValidationError} If validation fails
   * @throws {ConflictError} If user already exists
   * @throws {AppError} If an error occurs
   */
  async createUserWithResponse(username, firstName, lastName, password, role) {
    try {
      if (role && !['admin', 'user'].includes(role)) {
        throw new ValidationError("Invalid role. Must be 'admin' or 'user'");
      }

      const user = await this.createUser(username, firstName, lastName, password, role || 'user');
      const userPublic = this._userToPublic(user);
      return userPublic;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error.message && error.message.includes('already exists')) {
        throw new ConflictError(error.message);
      }
      this.logger.error('Failed creating user:', error);
      throw new AppError('Failed to create user', 500);
    }
  }

  /**
   * Reset a user's password
   * Matches Python's reset_password()
   * @param {string} username - Username
   * @param {string} newPassword - New password
   * @returns {Promise<{success: boolean}>} Success object
   * @throws {NotFoundError} If user not found
   * @throws {AppError} If an error occurs
   */
  async resetPassword(username, newPassword) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const passwordHash = await hashPassword(newPassword);

      const updateData = {
        password_hash: passwordHash,
        updated_at: new Date(),
      };

      await this._repository.updateOne(
        { username },
        { $set: updateData }
      );

      return { success: true };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed resetting password for user ${username}:`, error);
      throw new AppError('Failed to reset password', 500);
    }
  }

  /**
   * Regenerate API key for a user
   * Matches Python's regenerate_api_key()
   * @param {string} username - Username
   * @returns {Promise<{api_key: string}>} API key object
   * @throws {NotFoundError} If user not found
   * @throws {AppError} If an error occurs
   */
  async regenerateApiKey(username) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError(`User '${username}' not found`);
      }

      // Generate new API key
      const newApiKey = this._generateApiKey();
      user.api_key = newApiKey;
      user.updated_at = new Date();

      // Update database
      const updateData = {
        api_key: newApiKey,
        updated_at: user.updated_at,
      };

      await this._repository.updateOne(
        { username },
        { $set: updateData }
      );

      return { api_key: newApiKey };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed regenerating API key for user ${username}:`, error);
      throw new AppError('Failed to regenerate API key', 500);
    }
  }

  /**
   * Get profile for current user
   * @param {string} username - Username
   * @returns {Promise<Object>} User public object
   * @throws {NotFoundError} If user not found
   * @throws {AppError} If an error occurs
   */
  async getProfile(username) {
    try {
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const userPublic = this._userToPublic(user);
      return userPublic;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed getting profile for ${username}:`, error);
      throw new AppError('Failed to get profile', 500);
    }
  }

  /**
   * Update profile for current user
   * @param {string} username - Username
   * @param {Object} updates - Update fields
   * @returns {Promise<Object>} Updated user public object
   * @throws {AppError} If an error occurs
   */
  async updateProfile(username, updates) {
    try {
      // Allow first_name and last_name for profile updates
      const updateData = {};
      if (updates.first_name !== undefined) {
        updateData.first_name = updates.first_name;
      }
      if (updates.last_name !== undefined) {
        updateData.last_name = updates.last_name;
      }

      return await this.updateUser(username, updateData);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed updating profile for ${username}:`, error);
      throw new AppError('Failed to update profile', 500);
    }
  }

  /**
   * Change password for current user (requires current password verification)
   * @param {string} username - Username
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<{success: boolean, message: string}>} Success object
   * @throws {ValidationError} If current password is incorrect
   * @throws {AppError} If an error occurs
   */
  async changePassword(username, currentPassword, newPassword) {
    try {
      // Verify current password
      const authenticatedUser = await this.authenticateUser(username, currentPassword);
      if (!authenticatedUser) {
        throw new ValidationError('Current password is incorrect');
      }

      // Reset to new password
      await this.resetPassword(username, newPassword);

      return { success: true, message: 'Password changed successfully' };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed changing password for ${username}:`, error);
      throw new AppError('Failed to change password', 500);
    }
  }

  /**
   * Login - authenticate and return JWT token
   * Matches Python's UserService.login()
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<{success: boolean, user: Object, jwtToken: string}>} Login result with JWT token
   * @throws {ValidationError} If authentication fails
   */
  async login(username, password) {
    const user = await this.authenticateUser(username, password);

    if (!user) {
      throw new ValidationError('Invalid username or password');
    }

    // Create JWT token
    const jwtToken = createJWTToken(user.username, user.role);

    // Convert user to public model
    const userPublic = this._userToPublic(user);

    return {
      success: true,
      user: userPublic,
      jwtToken,
    };
  }

  /**
   * Logout - just returns success (cookie clearing handled by frontend)
   * @returns {Promise<{success: boolean}>} Success object
   */
  async logout() {
    return { success: true };
  }

  /**
   * Verify authentication status
   * @param {string} username - Username
   * @returns {Promise<{authenticated: boolean, user: Object|null}>} Authentication status
   */
  async verifyAuth(username) {
    const user = await this.getUserByUsername(username);

    if (!user || user.status !== 'active') {
      return { authenticated: false, user: null };
    }

    const userPublic = this._userToPublic(user);
    return { authenticated: true, user: userPublic };
  }

  /**
   * Add channel to user's watchlist
   * @param {string} username - Username
   * @param {string} channelKey - Channel key (format: live-{providerId}-{channelId})
   * @returns {Promise<void>}
   */
  async addChannelToWatchlist(username, channelKey) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError(`User with username ${username} not found`);
      }

      // Ensure watchlist object exists with proper structure
      const watchlist = user.watchlist || { movies: [], tvshows: [], live: [] };
      const watchlistChannels = new Set(watchlist.live || []);
      watchlistChannels.add(channelKey);

      // Update entire watchlist object to preserve structure
      const updatedWatchlist = {
        movies: watchlist.movies || [],
        tvshows: watchlist.tvshows || [],
        live: Array.from(watchlistChannels)
      };

      await this._repository.updateOne(
        { username },
        { $set: { watchlist: updatedWatchlist } }
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed to add channel to watchlist for user ${username}:`, error);
      throw new AppError('Failed to add channel to watchlist', 500);
    }
  }

  /**
   * Remove channel from user's watchlist
   * @param {string} username - Username
   * @param {string} channelKey - Channel key (format: live-{providerId}-{channelId})
   * @returns {Promise<void>}
   */
  async removeChannelFromWatchlist(username, channelKey) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError(`User with username ${username} not found`);
      }

      // Ensure watchlist object exists with proper structure
      const watchlist = user.watchlist || { movies: [], tvshows: [], live: [] };
      const watchlistChannels = new Set(watchlist.live || []);
      watchlistChannels.delete(channelKey);

      // Update entire watchlist object to preserve structure
      const updatedWatchlist = {
        movies: watchlist.movies || [],
        tvshows: watchlist.tvshows || [],
        live: Array.from(watchlistChannels)
      };

      await this._repository.updateOne(
        { username },
        { $set: { watchlist: updatedWatchlist } }
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed to remove channel from watchlist for user ${username}:`, error);
      throw new AppError('Failed to remove channel from watchlist', 500);
    }
  }

  /**
   * Get user's watchlist channel keys
   * @param {string} username - Username
   * @returns {Promise<Array<string>>} Array of channel keys
   */
  async getWatchlistChannelKeys(username) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        throw new NotFoundError(`User with username ${username} not found`);
      }
      const watchlist = user.watchlist || { movies: [], tvshows: [], live: [] };
      return watchlist.live || [];
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Failed to get watchlist channel keys for user ${username}:`, error);
      throw new AppError('Failed to get watchlist channel keys', 500);
    }
  }

  /**
   * Remove channel keys from all users' watchlists (bulk operation)
   * Used for cleanup when channels are deleted
   * @param {Array<string>} channelKeys - Array of channel keys to remove (format: live-{providerId}-{channelId})
   * @returns {Promise<number>} Number of users updated
   */
  async removeChannelKeysFromAllWatchlists(channelKeys) {
    try {
      if (!channelKeys || channelKeys.length === 0) {
        return 0;
      }

      const result = await this._repository.updateMany(
        { 'watchlist.live': { $in: channelKeys } },
        { $pull: { 'watchlist.live': { $in: channelKeys } } }
      );
      return result.modifiedCount || 0;
    } catch (error) {
      this.logger.error(`Failed to remove channel keys from watchlists: ${error.message}`);
      throw new AppError('Failed to remove channel keys from watchlists', 500);
    }
  }

  /**
   * Update user watchlist (add or remove title keys)
   * Matches Python's AuthenticationManager.update_user_watchlist()
   * @param {string} username - Username
   * @param {string[]} titleKeys - Array of title keys to add/remove
   * @param {boolean} add - If true, add to watchlist; if false, remove from watchlist
   * @returns {Promise<boolean>} True if successful, false otherwise
   */
  async updateUserWatchlist(username, titleKeys, add = true) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        return false;
      }

      // Ensure watchlist object exists with proper structure
      const watchlist = user.watchlist || { movies: [], tvshows: [], live: [] };
      
      // Separate title keys by media type
      const movies = new Set(watchlist.movies || []);
      const tvshows = new Set(watchlist.tvshows || []);
      
      titleKeys.forEach(key => {
        if (key.startsWith('movies-')) {
          if (add) {
            movies.add(key);
          } else {
            movies.delete(key);
          }
        } else if (key.startsWith('tvshows-')) {
          if (add) {
            tvshows.add(key);
          } else {
            tvshows.delete(key);
          }
        }
      });

      const updatedWatchlist = {
        movies: Array.from(movies),
        tvshows: Array.from(tvshows),
        live: watchlist.live || []
      };
      
      const updateData = {
        watchlist: updatedWatchlist,
        updated_at: new Date(),
      };

      await this._repository.updateOne(
        { username },
        { $set: updateData }
      );

      user.watchlist = updatedWatchlist;
      user.updated_at = updateData.updated_at;

      return true;
    } catch (error) {
      this.logger.error(`Failed updating watchlist for user ${username}:`, error);
      return false;
    }
  }

  /**
   * Get watchlist titles count per user and media type
   * Uses MongoDB aggregation for efficiency
   * @returns {Promise<Array<{user: string, media_type: string, count: number}>>}
   */
  async getWatchlistTitlesCountByUserAndType() {
    const pipeline = [
      {
        $match: {
          watchlist: { $exists: true },
          username: { $exists: true }
        }
      },
      {
        $project: {
          username: { $ifNull: ['$username', 'unknown'] },
          moviesCount: {
            $cond: {
              if: { $isArray: '$watchlist.movies' },
              then: { $size: '$watchlist.movies' },
              else: 0
            }
          },
          tvshowsCount: {
            $cond: {
              if: { $isArray: '$watchlist.tvshows' },
              then: { $size: '$watchlist.tvshows' },
              else: 0
            }
          }
        }
      },
      {
        $project: {
          username: 1,
          counts: [
            { media_type: 'movies', count: '$moviesCount' },
            { media_type: 'tvshows', count: '$tvshowsCount' }
          ]
        }
      },
      {
        $unwind: '$counts'
      },
      {
        $match: {
          'counts.count': { $gt: 0 }
        }
      },
      {
        $project: {
          _id: 0,
          user: '$username',
          media_type: '$counts.media_type',
          count: '$counts.count'
        }
      }
    ];
    
    return await this._repository.aggregate(pipeline);
  }

  /**
   * Get watchlist channels count per user
   * Uses MongoDB aggregation for efficiency
   * @returns {Promise<Array<{user: string, count: number}>>}
   */
  async getWatchlistChannelsCountByUser() {
    const pipeline = [
      {
        $match: {
          'watchlist.live': { $exists: true, $ne: [] },
          username: { $exists: true }
        }
      },
      {
        $project: {
          _id: 0,
          user: { $ifNull: ['$username', 'unknown'] },
          count: {
            $cond: {
              if: { $isArray: '$watchlist.live' },
              then: { $size: '$watchlist.live' },
              else: 0
            }
          }
        }
      },
      {
        $match: {
          count: { $gt: 0 }
        }
      }
    ];
    
    return await this._repository.aggregate(pipeline);
  }

  /**
   * Get count of active users (users with API key)
   * Uses MongoDB aggregation for efficiency
   * @returns {Promise<number>}
   */
  async getActiveUsersCount() {
    const pipeline = [
      {
        $match: {
          api_key: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        $count: 'count'
      }
    ];
    
    const result = await this._repository.aggregate(pipeline);
    return result.length > 0 ? result[0].count : 0;
  }
}

// Export class
export { UserManager };

