const db = require('../../src/utils/db');

// Mock the supabase client module using a factory function that returns a chainable mock
jest.mock('../../src/utils/supabaseClient', () => {
  const mockChain = {
    from: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })), // Default resolve
    maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })), // Default resolve
  };

  // Configure chaining: each method returns the mock object itself
  mockChain.from.mockReturnThis();
  mockChain.select.mockReturnThis();
  mockChain.eq.mockReturnThis();
  mockChain.order.mockReturnThis();
  mockChain.limit.mockReturnThis();
  mockChain.update.mockReturnThis();
  mockChain.insert.mockReturnThis();
  mockChain.upsert.mockReturnThis();
  mockChain.delete.mockReturnThis();
  
  return mockChain; // The factory returns the pre-configured mock
});

// Now require the mocked supabase client (it will be the object returned by the factory)
const supabase = require('../../src/utils/supabaseClient');

// Ensure we're in test mode
process.env.NODE_ENV = 'test';

describe('Database utility functions', () => {

  beforeEach(() => {
    // Reset mocks only
    jest.clearAllMocks();
    // Optionally reset terminal methods if needed, though tests should override
    // supabase.single.mockResolvedValue({ data: null, error: null });
    // supabase.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  describe('getAssessment', () => {
    it('should return assessment when found', async () => {
      const mockAssessment = { id: 1, url: 'example.com', domain: 'example.com' };
      
      // Configure the mock response for the terminal call (single)
      supabase.single.mockResolvedValue({ data: mockAssessment, error: null });

      const result = await db.getAssessment('example.com');

      // Assertions on the mock object returned by the factory
      expect(supabase.from).toHaveBeenCalledWith('websites');
      expect(supabase.select).toHaveBeenCalledWith('*');
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.single).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockAssessment);
    });

    it('should return null when no assessment found', async () => {
      // Configure the mock response for the terminal call to return null data
      supabase.single.mockResolvedValue({ data: null, error: null });
      
      const result = await db.getAssessment('example.com');
      
      expect(supabase.from).toHaveBeenCalledWith('websites');
      expect(supabase.select).toHaveBeenCalledWith('*');
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.single).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('should handle errors', async () => {
      // Configure the mock to reject for the terminal call
      const dbError = new Error('Database error');
      supabase.single.mockRejectedValue(dbError);

      await expect(db.getAssessment('example.com')).rejects.toThrow('Database error');

      expect(supabase.from).toHaveBeenCalledWith('websites');
      expect(supabase.select).toHaveBeenCalledWith('*');
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUnassessedUrls', () => {
    it('should return unassessed URLs', async () => {
      const mockUrls = [{ url: 'example1.com' }, { url: 'example2.com' }];
      // Configure the mock response for the limit() call, as it's the last step before await
      supabase.limit.mockResolvedValue({ data: mockUrls, error: null }); 
      
      const result = await db.getUnassessedUrls();
      
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.select).toHaveBeenCalledWith('*');
      expect(supabase.order).toHaveBeenCalledWith('first_recorded', { ascending: true });
      expect(supabase.limit).toHaveBeenCalledWith(100);
      // No longer checking supabase.then
      expect(result).toEqual(mockUrls);
    });

    it('should handle errors', async () => {
      // Configure the mock to reject at the limit() call
      const dbError = new Error('Database error');
      supabase.limit.mockRejectedValue(dbError);

      await expect(db.getUnassessedUrls()).rejects.toThrow('Database error');
      
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.limit).toHaveBeenCalledTimes(1); // Ensure limit was called
      // No longer checking supabase.then
    });
  });

  describe('updateUnassessedStatus', () => {
    it('should update status successfully', async () => {
      const mockResult = { url: 'example.com', status: 'processing' };
      // Configure the mock response for the terminal call (single)
      supabase.single.mockResolvedValue({ data: mockResult, error: null });
      
      await db.updateUnassessedStatus('example.com', 'processing');
      
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'processing' });
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });

    it('should handle errors', async () => {
      // Configure the mock to reject for the terminal call (single)
      const dbError = new Error('Update failed');
      supabase.single.mockRejectedValue(dbError);

      await expect(db.updateUnassessedStatus('example.com', 'processing')).rejects.toThrow('Update failed');
      
      // Add checks to ensure the chain was called
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'processing' });
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeFromUnassessedQueue', () => {
    it('should remove URL from queue', async () => {
      // Mock the initial check to find the entry
      supabase.single.mockResolvedValueOnce({ data: { url: 'example.com' }, error: null });
      // No need to mock delete resolution if we just check the chain
      // supabase.delete.mockResolvedValue({ data: [], error: null }); 
      
      await db.removeFromUnassessedQueue('example.com');
      
      // Check the initial select
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.select).toHaveBeenCalledWith('url');
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.single).toHaveBeenCalledTimes(1);
      
      // Check the delete chain
      // Note: supabase.from is called again by the function for the delete operation
      expect(supabase.from).toHaveBeenCalledTimes(2); 
      expect(supabase.delete).toHaveBeenCalledTimes(1);
      // eq is called twice: once for select, once for delete
      expect(supabase.eq).toHaveBeenCalledTimes(2); 
      expect(supabase.eq).toHaveBeenNthCalledWith(2, 'url', 'example.com'); 
    });

    it('should handle errors during delete', async () => {
      // Mock the initial check (.single) to succeed
      supabase.single.mockResolvedValue({ data: { url: 'example.com' }, error: null });
      
      // Mock the delete chain specifically
      const dbError = new Error('Delete failed');
      const mockDeleteEq = jest.fn().mockResolvedValue({ data: null, error: dbError });
      supabase.delete.mockImplementation(() => {
        return { eq: mockDeleteEq }; // Return a specific eq mock for the delete step
      });

      await expect(db.removeFromUnassessedQueue('example.com')).rejects.toThrow(dbError);

      // Check chain calls
      expect(supabase.single).toHaveBeenCalledTimes(1); 
      expect(supabase.delete).toHaveBeenCalledTimes(1); 
      expect(mockDeleteEq).toHaveBeenCalledTimes(1); // Check the specific eq mock for delete
      expect(mockDeleteEq).toHaveBeenCalledWith('url', 'example.com');
    });
    
    it('should handle errors during initial check', async () => {
      // Mock the initial check (.single) to fail
      const dbError = new Error('Check failed');
      supabase.single.mockRejectedValue(dbError); // Use mockRejectedValue, not Once

      await expect(db.removeFromUnassessedQueue('example.com')).rejects.toThrow('Check failed');

      // Check the initial select was attempted
      expect(supabase.from).toHaveBeenCalledWith('unassessed_urls');
      expect(supabase.select).toHaveBeenCalledWith('url');
      expect(supabase.eq).toHaveBeenCalledWith('url', 'example.com');
      expect(supabase.single).toHaveBeenCalledTimes(1);
      // Ensure delete was not called
      expect(supabase.delete).not.toHaveBeenCalled();
    });
  });

  describe('createAuditLog', () => {
    const logEntry = { url: 'example.com', action: 'test' };
    
    beforeEach(() => {
      // Clear mocks specifically for logEntry if it causes issues across tests
      // jest.clearAllMocks(); // Already done in outer beforeEach
    });

    it('should create audit log entry', async () => {
      const mockResult = { id: 1, ...logEntry, timestamp: new Date().toISOString() }; // Simulate DB result
      // Configure the mock response for the terminal call (single after insert+select)
      supabase.single.mockResolvedValue({ data: mockResult, error: null });
      
      await db.createAuditLog(logEntry);
      
      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
      // Check that insert was called with data including a timestamp
      expect(supabase.insert).toHaveBeenCalledWith(expect.objectContaining({
        ...logEntry,
        timestamp: expect.any(String), // Check if timestamp exists
      }));
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during insert', async () => {
       // Mock the insert operation (or subsequent single) to fail
      const dbError = new Error('Insert failed');
      // Since createAuditLog uses insert().select().single(), mock the final step
      supabase.single.mockRejectedValue(dbError); 

      // Need to define logEntry within the test scope or pass it
      const currentLogEntry = { url: 'example.com', action: 'test_error' }; 
      await expect(db.createAuditLog(currentLogEntry)).rejects.toThrow('Insert failed');

      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
      expect(supabase.insert).toHaveBeenCalledWith(expect.objectContaining(currentLogEntry));
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertAssessment', () => {
    it('should upsert assessment successfully', async () => {
      const assessment = { url: 'example.com', result: 'pass' };
      // Mock the terminal single() call after upsert().select()
      const mockResult = { id: 1, ...assessment }; 
      supabase.single.mockResolvedValue({ data: mockResult, error: null });
      
      await db.upsertAssessment(assessment);
      
      expect(supabase.from).toHaveBeenCalledWith('websites'); // Check table name
      expect(supabase.upsert).toHaveBeenCalledWith(expect.objectContaining(assessment)); // Use objectContaining if normalizeUrl adds properties
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });

    it('should handle errors', async () => {
      // Mock the terminal single() call to reject
      const dbError = new Error('Upsert failed');
      supabase.single.mockRejectedValue(dbError); 

      const assessment = { url: 'example.com', result: 'test result' };
      await expect(db.upsertAssessment(assessment)).rejects.toThrow('Upsert failed');

      // Check chain was called
      expect(supabase.from).toHaveBeenCalledWith('websites');
      expect(supabase.upsert).toHaveBeenCalledTimes(1);
      expect(supabase.select).toHaveBeenCalledTimes(1);
      expect(supabase.single).toHaveBeenCalledTimes(1);
    });
  });
}); 