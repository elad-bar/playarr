import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { createJWTToken } from '../utils/jwt.js';

/**
 * User manager for handling user operations
 * Matches Python's UserService and AuthenticationManager functionality
 */
class UserManager extends BaseManager {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepo - User repository
   */
  constructor(userRepo) {
    super('UserManager');
    this._userRepo = userRepo;
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
      await this._userRepo.updateOne(
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
    // Also include liveTV if present (for Live TV configuration)
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
    
    // Include liveTV if present
    if (user.liveTV !== undefined) {
      publicUser.liveTV = user.liveTV;
    }
    
    return publicUser;
  }

  /**
   * Get user by username (from database)
   * Matches Python's get_user_by_username()
   */
  async getUserByUsername(username) {
    // Query database (database service handles caching internally)
    try {
      const userData = await this._userRepo.findOneByQuery({ username });
      
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
      const userData = await this._userRepo.findOneByQuery({ api_key: apiKey });
      
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
   */
  async getAllUsers() {
    try {
      const usersData = await this._userRepo.findByQuery({});
      
      if (!usersData) {
        return { response: { users: [] }, statusCode: 200 };
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
      
      return { response: { users: usersPublic }, statusCode: 200 };
    } catch (error) {
      this.logger.error('Failed getting all users:', error);
      return { response: { error: 'Failed to get users' }, statusCode: 500 };
    }
  }

  /**
   * Get a specific user by username
   */
  async getUser(username) {
    try {
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        return { response: { error: 'User not found' }, statusCode: 404 };
      }

      const userPublic = this._userToPublic(user);
      return { response: userPublic, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed getting user ${username}:`, error);
      return { response: { error: 'Failed to get user' }, statusCode: 500 };
    }
  }

  /**
   * Delete user (deactivate by setting status to inactive)
   * Cannot delete default admin user
   */
  async deleteUser(username) {
    try {
      // Prevent deletion of default admin user
      const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
      if (username === defaultAdminUsername) {
        return { response: { error: 'Cannot delete default admin user' }, statusCode: 403 };
      }

      const result = await this.updateUser(username, { status: 'inactive' });
      return result;
    } catch (error) {
      this.logger.error(`Failed deleting user ${username}:`, error);
      return { response: { error: 'Failed to delete user' }, statusCode: 500 };
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
        watchlist: [],
        status: 'active',
        role: role || 'user',
        created_at: now,
        updated_at: now,
        isDefaultAdmin: username === defaultAdminUsername,
      };

      // Save to database
      await this._userRepo.insertOne(user);

      return user;
    } catch (error) {
      this.logger.error('Failed creating user:', error);
      throw error;
    }
  }

  /**
   * Update an existing user
   * Matches Python's update_user()
   */
  async updateUser(username, updates) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        return { response: { error: 'User not found' }, statusCode: 404 };
      }

      // Validate status
      if (updates.status !== undefined && !['active', 'inactive'].includes(updates.status)) {
        return { response: { error: "Invalid status. Must be 'active' or 'inactive'" }, statusCode: 400 };
      }

      // Validate role
      if (updates.role !== undefined && !['admin', 'user'].includes(updates.role)) {
        return { response: { error: "Invalid role. Must be 'admin' or 'user'" }, statusCode: 400 };
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
      if (updates.liveTV !== undefined) {
        user.liveTV = updates.liveTV;
        updateData.liveTV = updates.liveTV;
      }

      user.updated_at = new Date();
      updateData.updated_at = user.updated_at;

      // Update database
      await this._userRepo.updateOne(
        { username },
        { $set: updateData }
      );

      const userPublic = this._userToPublic(user);
      return { response: userPublic, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed updating user ${username}:`, error);
      return { response: { error: 'Failed to update user' }, statusCode: 500 };
    }
  }

  /**
   * Create user with response format
   */
  async createUserWithResponse(username, firstName, lastName, password, role) {
    try {
      if (role && !['admin', 'user'].includes(role)) {
        return { response: { error: "Invalid role. Must be 'admin' or 'user'" }, statusCode: 400 };
      }

      const user = await this.createUser(username, firstName, lastName, password, role || 'user');
      const userPublic = this._userToPublic(user);
      return { response: userPublic, statusCode: 201 };
    } catch (error) {
      if (error.message.includes('already exists')) {
        return { response: { error: error.message }, statusCode: 400 };
      }
      this.logger.error('Failed creating user:', error);
      return { response: { error: 'Failed to create user' }, statusCode: 500 };
    }
  }

  /**
   * Reset a user's password
   * Matches Python's reset_password()
   */
  async resetPassword(username, newPassword) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        return { response: { error: 'User not found' }, statusCode: 404 };
      }

      const passwordHash = await hashPassword(newPassword);

      const updateData = {
        password_hash: passwordHash,
        updated_at: new Date(),
      };

      await this._userRepo.updateOne(
        { username },
        { $set: updateData }
      );

      return { response: { success: true }, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed resetting password for user ${username}:`, error);
      return { response: { error: 'Failed to reset password' }, statusCode: 500 };
    }
  }

  /**
   * Regenerate API key for a user
   * Matches Python's regenerate_api_key()
   */
  async regenerateApiKey(username) {
    try {
      const user = await this.getUserByUsername(username);
      if (!user) {
        return { response: { error: `User '${username}' not found` }, statusCode: 404 };
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

      await this._userRepo.updateOne(
        { username },
        { $set: updateData }
      );

      return { response: { api_key: newApiKey }, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed regenerating API key for user ${username}:`, error);
      return { response: { error: 'Failed to regenerate API key' }, statusCode: 500 };
    }
  }

  /**
   * Get profile for current user
   */
  async getProfile(username) {
    try {
      const user = await this.getUserByUsername(username);
      
      if (!user) {
        return { response: { error: 'User not found' }, statusCode: 404 };
      }

      const userPublic = this._userToPublic(user);
      return { response: userPublic, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed getting profile for ${username}:`, error);
      return { response: { error: 'Failed to get profile' }, statusCode: 500 };
    }
  }

  /**
   * Update profile for current user
   */
  async updateProfile(username, updates) {
    try {
      // Allow first_name, last_name, and liveTV for profile updates
      const updateData = {};
      if (updates.first_name !== undefined) {
        updateData.first_name = updates.first_name;
      }
      if (updates.last_name !== undefined) {
        updateData.last_name = updates.last_name;
      }
      if (updates.liveTV !== undefined) {
        updateData.liveTV = updates.liveTV;
      }

      return await this.updateUser(username, updateData);
    } catch (error) {
      this.logger.error(`Failed updating profile for ${username}:`, error);
      return { response: { error: 'Failed to update profile' }, statusCode: 500 };
    }
  }

  /**
   * Change password for current user (requires current password verification)
   */
  async changePassword(username, currentPassword, newPassword) {
    try {
      // Verify current password
      const authenticatedUser = await this.authenticateUser(username, currentPassword);
      if (!authenticatedUser) {
        return { response: { error: 'Current password is incorrect' }, statusCode: 401 };
      }

      // Reset to new password
      const result = await this.resetPassword(username, newPassword);
      if (result.statusCode !== 200) {
        return result;
      }

      return { response: { success: true, message: 'Password changed successfully' }, statusCode: 200 };
    } catch (error) {
      this.logger.error(`Failed changing password for ${username}:`, error);
      return { response: { error: 'Failed to change password' }, statusCode: 500 };
    }
  }

  /**
   * Login - authenticate and return JWT token
   * Matches Python's UserService.login()
   */
  async login(username, password) {
    const user = await this.authenticateUser(username, password);

    if (!user) {
      return { response: { error: 'Invalid username or password' }, statusCode: 401, jwtToken: null };
    }

    // Create JWT token
    const jwtToken = createJWTToken(user.username, user.role);

    // Convert user to public model
    const userPublic = this._userToPublic(user);

    return {
      response: { success: true, user: userPublic },
      statusCode: 200,
      jwtToken,
    };
  }

  /**
   * Logout - just returns success (cookie clearing handled by frontend)
   */
  async logout() {
    return { response: { success: true }, statusCode: 200 };
  }

  /**
   * Verify authentication status
   */
  async verifyAuth(username) {
    const user = await this.getUserByUsername(username);

    if (!user || user.status !== 'active') {
      return { response: { authenticated: false, user: null }, statusCode: 200 };
    }

    const userPublic = this._userToPublic(user);
    return { response: { authenticated: true, user: userPublic }, statusCode: 200 };
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

      const watchlist = new Set(user.watchlist || []);
      
      if (add) {
        titleKeys.forEach(key => watchlist.add(key));
      } else {
        titleKeys.forEach(key => watchlist.delete(key));
      }

      const updatedWatchlist = Array.from(watchlist);
      const updateData = {
        watchlist: updatedWatchlist,
        updated_at: new Date(),
      };

      await this._userRepo.updateOne(
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
}

// Export class
export { UserManager };

