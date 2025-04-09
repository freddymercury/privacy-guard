/**
 * Test for suggested policy URLs functionality
 */

const assert = require("assert");
const axios = require("axios");
const { normalizeUrl } = require("../../src/utils/domainUtils");
const assessmentTriggerService = require("../../src/services/assessmentTriggerService");
const db = require("../../src/utils/db");

// Mock axios
jest.mock("axios");

// Mock db
jest.mock("../../src/utils/db", () => {
  const mockDb = {
    normalizeUrl: jest.fn((url) => url),
    updateSuggestedPolicyUrls: jest.fn(),
    getAssessment: jest.fn(),
    removeFromUnassessedQueue: jest.fn(),
    updateUnassessedStatus: jest.fn(),
    createAuditLog: jest.fn(),
    upsertAssessment: jest.fn(),
    getUnassessedUrls: jest.fn(),
  };

  // Mock Supabase client with chained methods
  const supabaseMock = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };

  mockDb.supabase = supabaseMock;
  return mockDb;
});

describe("Suggested Policy URLs", () => {
  const url = "example.com";
  const longPrivacyPolicy = "A".repeat(10000); // Create a long enough privacy policy text

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    db.supabase.single.mockResolvedValue({
      data: {
        suggested_policy_urls: ["https://example.com/privacy"],
      },
      error: null,
    });

    db.supabase.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    axios.get.mockResolvedValue({
      status: 200,
      data: "<html><body>" + longPrivacyPolicy + "</body></html>",
    });
  });

  describe("locateUserAgreement", () => {
    it("should try suggested policy URLs first", async () => {
      // Call the function
      const result = await assessmentTriggerService.locateUserAgreement(url);

      // Assertions
      expect(db.supabase.from).toHaveBeenCalledWith("unassessed_urls");
      expect(db.supabase.select).toHaveBeenCalledWith("suggested_policy_urls");
      expect(db.supabase.eq).toHaveBeenCalledWith("url", url);
      expect(axios.get).toHaveBeenCalledWith(
        "https://example.com/privacy",
        expect.any(Object)
      );
      expect(result).toEqual({
        text: expect.any(String),
        agreementUrl: "https://example.com/privacy",
      });
    });

    it("should fall back to common paths if suggested URLs fail", async () => {
      // Mock suggested URL failure
      axios.get.mockRejectedValueOnce(new Error("Failed to fetch"));

      // Call the function
      const result = await assessmentTriggerService.locateUserAgreement(url);

      // Assertions
      expect(db.supabase.from).toHaveBeenCalledWith("unassessed_urls");
      expect(db.supabase.select).toHaveBeenCalledWith("suggested_policy_urls");
      expect(db.supabase.eq).toHaveBeenCalledWith("url", url);
      expect(axios.get).toHaveBeenCalledWith(
        "https://example.com/privacy",
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("https://example.com/"),
        expect.any(Object)
      );
      expect(result).toEqual({
        text: expect.any(String),
        agreementUrl: expect.stringContaining("https://example.com/"),
      });
    });

    it("should handle Google domains specially", async () => {
      const googleUrl = "google.com";
      
      // Mock suggested URL failure
      axios.get.mockRejectedValueOnce(new Error("Failed to fetch"));

      // Call the function
      const result = await assessmentTriggerService.locateUserAgreement(googleUrl);

      // Assertions
      expect(db.supabase.from).toHaveBeenCalledWith("unassessed_urls");
      expect(db.supabase.select).toHaveBeenCalledWith("suggested_policy_urls");
      expect(db.supabase.eq).toHaveBeenCalledWith("url", googleUrl);
      expect(axios.get).toHaveBeenCalledWith(
        "https://google.com/policies/privacy",
        expect.any(Object)
      );
      expect(result).toEqual({
        text: expect.any(String),
        agreementUrl: "https://google.com/policies/privacy",
      });
    });
  });

  describe("updateSuggestedPolicyUrls", () => {
    it("should update suggested policy URLs", async () => {
      const suggestedUrls = ["https://example.com/privacy-suggested"];
      
      // Mock the database response
      db.updateSuggestedPolicyUrls.mockResolvedValue({
        url,
        suggested_policy_urls: suggestedUrls,
      });

      // Call the function
      const result = await db.updateSuggestedPolicyUrls(url, suggestedUrls);

      // Assertions
      expect(db.updateSuggestedPolicyUrls).toHaveBeenCalledWith(url, suggestedUrls);
      expect(result).toEqual({
        url,
        suggested_policy_urls: suggestedUrls,
      });
    });
  });

  describe("processUnassessedUrl", () => {
    it("should handle already assessed URLs", async () => {
      // Mock getAssessment to return an existing assessment
      db.getAssessment.mockResolvedValue({
        url,
        privacy_assessment: "Some assessment",
        last_updated: new Date().toISOString()
      });

      // Call the function
      const result = await assessmentTriggerService.processUnassessedUrl({ url });

      // Assertions
      expect(db.getAssessment).toHaveBeenCalledWith(url);
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Processing");
      expect(db.removeFromUnassessedQueue).toHaveBeenCalledWith(url);
      expect(result).toEqual({
        success: true,
        status: "Already Assessed",
        url
      });
    });

    it("should process new unassessed URLs", async () => {
      // Mock getAssessment to return null (no existing assessment)
      db.getAssessment.mockResolvedValue(null);

      // Call the function
      const result = await assessmentTriggerService.processUnassessedUrl({ url });

      // Assertions
      expect(db.getAssessment).toHaveBeenCalledWith(url);
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Processing");
      expect(db.removeFromUnassessedQueue).toHaveBeenCalledWith(url);
      expect(result).toEqual({
        success: true,
        status: "Completed",
        url,
        riskLevel: expect.any(String)
      });
    });

    it("should handle errors during processing", async () => {
      // Mock getAssessment to return null
      db.getAssessment.mockResolvedValue(null);
      
      // Mock axios to throw an error
      axios.get.mockRejectedValue(new Error("Network error"));

      // Call the function
      const result = await assessmentTriggerService.processUnassessedUrl({ url });

      // Assertions
      expect(db.getAssessment).toHaveBeenCalledWith(url);
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Processing");
      expect(db.updateUnassessedStatus).toHaveBeenCalledWith(url, "Not Found");
      expect(db.removeFromUnassessedQueue).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        status: "Not Found",
        url
      });
    });
  });
});
