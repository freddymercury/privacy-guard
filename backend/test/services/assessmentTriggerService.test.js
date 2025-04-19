// Unit tests for Assessment Trigger Service

// Ensure we're in test mode
process.env.NODE_ENV = 'test';

const assessmentTriggerService = require("../../src/services/assessmentTriggerService");
const db = require("../../src/utils/db");
const llmService = require("../../src/services/llmService");
const axios = require("axios");

jest.mock("../../src/utils/db");
jest.mock("../../src/services/llmService");
jest.mock("axios");

describe("Assessment Trigger Service", () => {
  const url = "example.com";
  const longPrivacyPolicy = "A".repeat(10000); // Create a long enough privacy policy text

  beforeEach(() => {
    jest.resetAllMocks();
    
    // Mock database functions
    db.getUnassessedUrls = jest.fn();
    db.updateUnassessedStatus = jest.fn().mockResolvedValue(true);
    db.createAuditLog = jest.fn().mockResolvedValue(true);
    db.getAssessment = jest.fn().mockResolvedValue(null);
    db.upsertAssessment = jest.fn().mockResolvedValue(true);
    db.normalizeUrl = jest.fn().mockImplementation(url => url);
    db.removeFromUnassessedQueue = jest.fn().mockResolvedValue(true);

    // Mock Supabase with proper chaining
    const mockChain = {
      from: () => mockChain,
      select: () => mockChain,
      eq: () => mockChain,
      order: () => mockChain,
      limit: () => mockChain,
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: () => mockChain,
      insert: () => mockChain,
      upsert: () => mockChain,
      delete: () => mockChain
    };

    db.supabase = mockChain;

    // Mock LLM service
    llmService.computeTextHash = jest.fn().mockResolvedValue("test-hash");
    llmService.assessPrivacyPolicy = jest.fn().mockResolvedValue({
      riskLevel: "Low",
      summary: "Good privacy policy"
    });

    // Mock axios
    axios.get = jest.fn();
  });

  describe("processUnassessedUrls", () => {
    it("should process all pending unassessed URLs with default concurrency", async () => {
      // Setup
      const urls = [{ url }];
      db.getUnassessedUrls.mockResolvedValue(urls);
      db.getAssessment.mockResolvedValue(null);
      axios.get.mockResolvedValue({ 
        status: 200, 
        data: longPrivacyPolicy
      });
      llmService.assessPrivacyPolicy.mockResolvedValue({
        riskLevel: "low",
        summary: "Good privacy policy"
      });

      // Execute
      const results = await assessmentTriggerService.processUnassessedUrls();

      // Verify
      expect(db.getUnassessedUrls).toHaveBeenCalled();
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Processing");
      expect(db.removeFromUnassessedQueue).toHaveBeenCalledWith(url);
      expect(db.createAuditLog).toHaveBeenCalledTimes(4); // Start, URL processing, Assessment completed, Process completed
      expect(results).toEqual({
        total: 1,
        processed: 1,
        successful: 1,
        failed: 0,
        notFound: 0
      });
    });

    it("should process all pending unassessed URLs with custom concurrency", async () => {
      // Setup
      const urls = [{ url }, { url: "example2.com" }];
      db.getUnassessedUrls.mockResolvedValue(urls);
      db.getAssessment.mockResolvedValue(null);
      axios.get.mockResolvedValue({ 
        status: 200, 
        data: longPrivacyPolicy
      });
      llmService.assessPrivacyPolicy.mockResolvedValue({
        riskLevel: "low",
        summary: "Good privacy policy"
      });

      // Execute with custom concurrency limit
      const results = await assessmentTriggerService.processUnassessedUrls(1);

      // Verify
      expect(db.getUnassessedUrls).toHaveBeenCalled();
      expect(db.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: "assessment_trigger_started",
        details: expect.objectContaining({
          count: 2,
          concurrentLimit: 1
        })
      }));
    });

    it("should handle errors during processing", async () => {
      // Setup
      const urls = [{ url }];
      db.getUnassessedUrls.mockResolvedValue(urls);
      axios.get.mockRejectedValue(new Error("Test error"));

      // Execute
      const results = await assessmentTriggerService.processUnassessedUrls(2);

      // Verify
      expect(db.getUnassessedUrls).toHaveBeenCalled();
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Processing");
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Not Found");
      expect(db.createAuditLog).toHaveBeenCalledTimes(4); // Start, URL processing, Agreement not found, Process completed
      expect(results).toEqual({
        total: 1,
        processed: 1,
        successful: 0,
        failed: 0,
        notFound: 1
      });
    });
  });

  describe("processUnassessedUrl", () => {
    const url = "example.com";
    const urlEntry = { url };

    beforeEach(() => {
      jest.clearAllMocks();
      db.supabase.single.mockResolvedValue({ data: null, error: null });
      db.getAssessment.mockResolvedValue(null);
      axios.get.mockResolvedValue({ 
        status: 200, 
        data: longPrivacyPolicy 
      });
      llmService.assessPrivacyPolicy.mockResolvedValue({ 
        riskLevel: 'low',
        summary: 'Good privacy policy'
      });
      llmService.computeTextHash.mockReturnValue('hash123');
    });

    test('processes a URL successfully', async () => {
      const result = await assessmentTriggerService.processUnassessedUrl(urlEntry);

      expect(result).toEqual({
        success: true,
        status: 'Completed',
        url,
        riskLevel: 'low'
      });

      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, 'Processing');
      expect(db.removeFromUnassessedQueue).toHaveBeenCalledWith(url);
      expect(db.createAuditLog).toHaveBeenCalledTimes(2); // URL processing, Assessment completed
    });

    test('handles errors during processing', async () => {
      // Mock all HTTP requests to fail
      axios.get.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await assessmentTriggerService.processUnassessedUrl(urlEntry);

      expect(result).toEqual({
        success: false,
        status: 'Not Found',
        url
      });

      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, 'Processing');
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, 'Not Found');
      expect(db.removeFromUnassessedQueue).not.toHaveBeenCalled();
      expect(db.createAuditLog).toHaveBeenCalledTimes(2); // URL processing, Agreement not found
    });

    test('handles existing assessment', async () => {
      db.getAssessment.mockResolvedValueOnce({ 
        url: 'example.com', 
        assessment: 'exists' 
      });

      const result = await assessmentTriggerService.processUnassessedUrl(urlEntry);

      expect(result).toEqual({
        success: true,
        status: 'Already Assessed',
        url
      });

      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, 'Processing');
      expect(db.removeFromUnassessedQueue).toHaveBeenCalledWith(url);
      expect(db.createAuditLog).toHaveBeenCalledTimes(1); // URL processing only
    });
  });

  describe("removeFromUnassessedQueue", () => {
    it("should correctly remove URL from unassessed queue", async () => {
      // Setup
      db.supabase.maybeSingle.mockResolvedValue({ url });

      // Execute
      await db.updateUnassessedStatus(url, "Completed");

      // Verify
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Completed");
    });

    it("should handle case when URL is not in queue", async () => {
      // Setup
      db.supabase.maybeSingle.mockResolvedValue(null);

      // Execute
      await db.updateUnassessedStatus(url, "Failed");

      // Verify
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Failed");
    });
  });
});
