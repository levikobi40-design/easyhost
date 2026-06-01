/**
 * Security Service
 * Implements Zero-Trust Architecture and encryption utilities
 */

// AES-256 encryption utilities (using Web Crypto API)
class SecurityService {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
    this.ivLength = 12;
    this.tagLength = 128;
    this.sessionKey = null;
  }

  /**
   * Generate a random encryption key
   */
  async generateKey() {
    const key = await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true,
      ['encrypt', 'decrypt']
    );
    return key;
  }

  /**
   * Generate a random IV
   */
  generateIV() {
    return crypto.getRandomValues(new Uint8Array(this.ivLength));
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  async encrypt(data, key) {
    const iv = this.generateIV();
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(JSON.stringify(data));

    const encryptedData = await crypto.subtle.encrypt(
      {
        name: this.algorithm,
        iv: iv,
        tagLength: this.tagLength,
      },
      key,
      encodedData
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedData), iv.length);

    return this.arrayBufferToBase64(combined);
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  async decrypt(encryptedString, key) {
    const combined = this.base64ToArrayBuffer(encryptedString);
    const iv = combined.slice(0, this.ivLength);
    const data = combined.slice(this.ivLength);

    const decryptedData = await crypto.subtle.decrypt(
      {
        name: this.algorithm,
        iv: iv,
        tagLength: this.tagLength,
      },
      key,
      data
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedData));
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert Base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Hash data using SHA-256
   */
  async hash(data) {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encodedData);
    return this.arrayBufferToBase64(hashBuffer);
  }

  /**
   * Generate a secure session token
   */
  generateSessionToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Validate session token format
   */
  validateSessionToken(token) {
    return /^[a-f0-9]{64}$/.test(token);
  }

  /**
   * Zero-Trust: Validate every request
   */
  validateRequest(request, userContext) {
    // Verify user context
    if (!userContext || !userContext.userId || !userContext.sessionToken) {
      return { valid: false, reason: 'Missing user context' };
    }

    // Verify session token
    if (!this.validateSessionToken(userContext.sessionToken)) {
      return { valid: false, reason: 'Invalid session token' };
    }

    // Verify permissions
    if (!this.hasPermission(userContext, request.resource, request.action)) {
      return { valid: false, reason: 'Insufficient permissions' };
    }

    // Rate limiting check (simplified)
    if (!this.checkRateLimit(userContext.userId)) {
      return { valid: false, reason: 'Rate limit exceeded' };
    }

    return { valid: true };
  }

  /**
   * Check if user has permission for action
   */
  hasPermission(userContext, resource, action) {
    const permissions = {
      owner: {
        '*': ['read', 'write', 'delete', 'admin'],
      },
      staff: {
        rooms: ['read', 'write'],
        bookings: ['read', 'write'],
        notifications: ['read'],
        leads: ['read'],
      },
      guest: {
        rooms: ['read'],
        services: ['read', 'request'],
      },
    };

    const rolePermissions = permissions[userContext.role];
    if (!rolePermissions) return false;

    // Check wildcard permissions
    if (rolePermissions['*']?.includes(action)) return true;

    // Check specific resource permissions
    return rolePermissions[resource]?.includes(action) || false;
  }

  /**
   * Simple rate limiting (in production, use Redis or similar)
   */
  checkRateLimit(userId) {
    const key = `rateLimit_${userId}`;
    const limit = 100; // requests per minute
    const now = Date.now();
    const windowMs = 60000;

    // Get current window data from sessionStorage
    let windowData = JSON.parse(sessionStorage.getItem(key) || '{"count": 0, "start": 0}');

    // Reset if window expired
    if (now - windowData.start > windowMs) {
      windowData = { count: 1, start: now };
    } else {
      windowData.count++;
    }

    sessionStorage.setItem(key, JSON.stringify(windowData));

    return windowData.count <= limit;
  }

  /**
   * Sanitize input to prevent XSS
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validate and sanitize API response
   */
  sanitizeResponse(response) {
    // Remove sensitive fields
    const sensitiveFields = ['password', 'apiKey', 'secretKey', 'token'];
    const sanitized = { ...response };

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        delete sanitized[field];
      }
    });

    return sanitized;
  }

  /**
   * Log security event
   */
  logSecurityEvent(event) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: event.type,
      userId: event.userId,
      action: event.action,
      resource: event.resource,
      success: event.success,
      ip: event.ip || 'unknown',
      userAgent: navigator.userAgent,
    };

    // In production, send to security monitoring service
    console.log('[Security Event]', logEntry);

    // Store locally for audit trail
    const auditLog = JSON.parse(localStorage.getItem('auditLog') || '[]');
    auditLog.push(logEntry);
    // Keep last 1000 entries
    if (auditLog.length > 1000) {
      auditLog.splice(0, auditLog.length - 1000);
    }
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
  }
}

// Singleton instance
export const securityService = new SecurityService();

export default securityService;
