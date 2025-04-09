// LLM Service for PrivacyGuard backend

const db = require('../utils/db');

// Check if we're running in a test environment
const isTestEnvironment =
  process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined;

let OpenAI, llm;

if (!isTestEnvironment) {
  try {
    // Only import and initialize OpenAI in non-test environments
    const llamaindex = require("llamaindex");
    OpenAI = llamaindex.OpenAI;

    // Initialize OpenAI as the LLM provider
    llm = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.LLM_MODEL || "gpt-4",
      temperature: 0.2, // Lower temperature for more consistent results
    });
  } catch (error) {
    console.error("Error initializing LLM:", error);
    // Provide a minimal mock for development without API keys
    llm = {
      complete: async () => ({
        text: '{"categories":{},"overallRisk":"Unknown","summary":"Mock response"}',
      }),
    };
  }
} else {
  // Provide a minimal mock for tests
  llm = {
    complete: async () => ({
      text: '{"categories":{},"overallRisk":"Unknown","summary":"Mock response"}',
    }),
  };
}

/**
 * Privacy risk categories
 */
const PRIVACY_CATEGORIES = [
  "Data Collection & Use",
  "Third-Party Sharing & Selling",
  "Data Storage & Security",
  "User Rights & Control",
  "AI & Automated Decision-Making",
  "Policy Changes & Updates",
];

/**
 * Risk levels
 */
const RISK_LEVELS = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNKNOWN: "Unknown",
};

/**
 * Split text into chunks of approximately the specified size
 * @param {string} text - Text to split
 * @param {number} maxChunkSize - Maximum chunk size in characters
 * @returns {Array<string>} - Array of text chunks
 */
const splitTextIntoChunks = (text, maxChunkSize = 3000) => {
  // Split at paragraph boundaries when possible
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed the chunk size, start a new chunk
    if (
      currentChunk.length + paragraph.length > maxChunkSize &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + paragraph;
    }
  }

  // Add the last chunk if it's not empty
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * More accurate token estimation function
 * @param {string} text - Text to estimate tokens for
 * @returns {number} - Estimated token count
 */
const estimateTokens = (text) => {
  // More conservative estimation:
  // 1. Count words and multiply by 1.5 for punctuation/spaces
  // 2. Add 20% buffer for safety
  // 3. Add a constant for potential special tokens
  const wordCount = text.split(/\s+/).length;
  return Math.ceil(wordCount * 1.5 * 1.2) + 20;
};

/**
 * Call LLM with retry logic for rate limit errors
 * @param {string} prompt - The prompt to send to the LLM
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} initialDelay - Initial delay in ms before retrying
 * @returns {Promise<Object>} - LLM response
 */
const callLLMWithRetry = async (
  prompt,
  maxRetries = 5,
  initialDelay = 5000
) => {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt <= maxRetries) {
    try {
      console.log(`LLM API call attempt ${attempt + 1}/${maxRetries + 1}`);
      const response = await llm.complete({
        prompt,
        temperature: 0.2,
        maxTokens: 1500, // Reduced from 2000
      });
      return response;
    } catch (error) {
      attempt++;

      // If it's a rate limit error and we have retries left
      if (
        (error.status === 429 ||
          (error.error && error.error.code === "rate_limit_exceeded")) &&
        attempt <= maxRetries
      ) {
        console.log(`Rate limit hit, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else if (attempt <= maxRetries) {
        // For other errors, retry with less backoff
        console.log(
          `API error: ${
            error.message || "Unknown error"
          }, retrying in ${initialDelay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, initialDelay));
      } else {
        // No more retries, throw the error
        throw error;
      }
    }
  }
};

/**
 * Assess privacy policy text
 * @param {string} policyText - The privacy policy text to assess
 * @returns {Promise<Object>} - Assessment results
 */
const assessPrivacyPolicy = async (policyText) => {
  try {
    // Use more accurate token estimation
    const estimatedTokens = estimateTokens(policyText);
    const textLength = policyText.length;

    // Always use chunking for policies over 10,000 characters, regardless of token estimate
    // This is a more conservative approach to avoid rate limits
    if (estimatedTokens < 8000 && textLength < 10000) {
      console.log(
        `Processing policy directly (est. ${estimatedTokens} tokens, ${textLength} chars)`
      );
      const prompt = createAssessmentPrompt(policyText);
      const response = await callLLMWithRetry(prompt);
      return parseAssessmentResponse(response.text);
    }

    // For larger policies, split into chunks and process each chunk
    console.log(
      `Policy text is large (est. ${Math.round(
        estimatedTokens
      )} tokens, ${textLength} chars), splitting into chunks`
    );

    // Split text into smaller chunks (target ~4000 tokens per chunk)
    const chunks = splitTextIntoChunks(policyText, 4000 * 4); // 4000 tokens ≈ 16000 chars
    console.log(`Split policy into ${chunks.length} chunks`);

    // Process each chunk
    const chunkAssessments = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);
      const chunkPrompt = createChunkAssessmentPrompt(
        chunks[i],
        i + 1,
        chunks.length
      );

      // Use retry logic for each chunk
      const chunkResponse = await callLLMWithRetry(chunkPrompt);
      const chunkAssessment = parseAssessmentResponse(chunkResponse.text);
      chunkAssessments.push(chunkAssessment);

      // Add a longer delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        const delayMs = 5000; // 5 seconds
        console.log(
          `Adding ${delayMs}ms delay between chunk processing to avoid rate limits`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Combine chunk assessments into a final assessment
    return combineChunkAssessments(chunkAssessments);
  } catch (error) {
    console.error("Error assessing privacy policy:", error);
    throw new Error("Failed to assess privacy policy");
  }
};

/**
 * Create assessment prompt for LLM
 * @param {string} policyText - The privacy policy text
 * @returns {string} - Formatted prompt
 */
const createAssessmentPrompt = (policyText) => {
  return `Analyze this privacy policy and assess risks for users.

Categories to evaluate (High/Medium/Low/Unknown risk):
${PRIVACY_CATEGORIES.map((category) => `- ${category}`).join("\n")}

Risk definitions:
- High: Severe concerns (selling data, minimal control)
- Medium: Moderate concerns with opt-outs
- Low: User-friendly, privacy-conscious
- Unknown: Not mentioned

Privacy Policy:
${policyText}

Respond with JSON:
{
  "categories": {
    "Category Name": {
      "risk": "High/Medium/Low/Unknown",
      "explanation": "Brief explanation"
    }
  },
  "overallRisk": "High/Medium/Low/Unknown",
  "summary": "Brief overall summary"
}`;
};

/**
 * Create assessment prompt for a chunk of the privacy policy
 * @param {string} chunkText - The chunk of privacy policy text
 * @param {number} chunkNumber - Current chunk number
 * @param {number} totalChunks - Total number of chunks
 * @returns {string} - Formatted prompt
 */
const createChunkAssessmentPrompt = (chunkText, chunkNumber, totalChunks) => {
  return `Analyze CHUNK ${chunkNumber}/${totalChunks} of this privacy policy.

Only assess categories addressed in this chunk (High/Medium/Low/Unknown risk):
${PRIVACY_CATEGORIES.map((category) => `- ${category}`).join("\n")}

Risk definitions:
- High: Severe concerns (selling data, minimal control)
- Medium: Moderate concerns with opt-outs
- Low: User-friendly, privacy-conscious
- Unknown: Not mentioned

Privacy Policy Chunk ${chunkNumber}/${totalChunks}:
${chunkText}

Respond with JSON:
{
  "categories": {
    "Category Name": {
      "risk": "High/Medium/Low/Unknown",
      "explanation": "Brief explanation"
    }
  },
  "overallRisk": "High/Medium/Low/Unknown",
  "summary": "Brief summary of this chunk's content"
}`;
};

/**
 * Combine multiple chunk assessments into a final assessment
 * @param {Array<Object>} chunkAssessments - Array of chunk assessments
 * @returns {Object} - Combined assessment
 */
const combineChunkAssessments = (chunkAssessments) => {
  // Initialize combined categories with Unknown risk
  const combinedCategories = {};
  for (const category of PRIVACY_CATEGORIES) {
    combinedCategories[category] = {
      risk: RISK_LEVELS.UNKNOWN,
      explanation: "Not addressed in the policy",
    };
  }

  // Combine chunk summaries
  const chunkSummaries = chunkAssessments.map(
    (a) => a.summary || "No summary available"
  );

  // Track risk levels found for each category
  const categoryRiskCounts = {};
  PRIVACY_CATEGORIES.forEach((category) => {
    categoryRiskCounts[category] = {
      [RISK_LEVELS.HIGH]: 0,
      [RISK_LEVELS.MEDIUM]: 0,
      [RISK_LEVELS.LOW]: 0,
      [RISK_LEVELS.UNKNOWN]: 0,
    };
  });

  // Process each chunk assessment
  for (const assessment of chunkAssessments) {
    // Update categories based on this chunk
    for (const category in assessment.categories) {
      const chunkCategoryData = assessment.categories[category];

      // Count the risk level for this category
      if (chunkCategoryData.risk in categoryRiskCounts[category]) {
        categoryRiskCounts[category][chunkCategoryData.risk]++;
      }

      // If this chunk has a non-Unknown risk for a category, use its data
      if (
        chunkCategoryData.risk !== RISK_LEVELS.UNKNOWN &&
        (combinedCategories[category].risk === RISK_LEVELS.UNKNOWN ||
          getRiskPriority(chunkCategoryData.risk) >
            getRiskPriority(combinedCategories[category].risk))
      ) {
        combinedCategories[category] = {
          risk: chunkCategoryData.risk,
          explanation: chunkCategoryData.explanation,
        };
      }
    }
  }

  // Determine overall risk level (prioritize higher risks)
  let overallRisk = RISK_LEVELS.UNKNOWN;
  for (const category in combinedCategories) {
    if (
      getRiskPriority(combinedCategories[category].risk) >
      getRiskPriority(overallRisk)
    ) {
      overallRisk = combinedCategories[category].risk;
    }
  }

  // Create a comprehensive summary
  const summary = `This privacy policy assessment is based on analysis of multiple sections. ${chunkSummaries.join(
    " "
  )}`;

  return {
    categories: combinedCategories,
    riskLevel: overallRisk,
    summary: summary,
  };
};

/**
 * Get priority value for risk levels (for comparison)
 * @param {string} riskLevel - Risk level
 * @returns {number} - Priority value (higher = more severe)
 */
const getRiskPriority = (riskLevel) => {
  switch (riskLevel) {
    case RISK_LEVELS.HIGH:
      return 3;
    case RISK_LEVELS.MEDIUM:
      return 2;
    case RISK_LEVELS.LOW:
      return 1;
    case RISK_LEVELS.UNKNOWN:
    default:
      return 0;
  }
};

/**
 * Parse LLM response into structured assessment
 * @param {string} responseText - LLM response text
 * @returns {Object} - Structured assessment
 */
const parseAssessmentResponse = (responseText) => {
  try {
    // Extract JSON from response (in case there's additional text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in response");
    }

    const assessment = JSON.parse(jsonMatch[0]);

    // Validate assessment structure
    if (
      !assessment.categories ||
      !assessment.overallRisk ||
      !assessment.summary
    ) {
      throw new Error("Invalid assessment structure");
    }

    // Normalize risk levels
    for (const category in assessment.categories) {
      const riskLevel = assessment.categories[category].risk;
      assessment.categories[category].risk = normalizeRiskLevel(riskLevel);
    }

    assessment.overallRisk = normalizeRiskLevel(assessment.overallRisk);

    return {
      categories: assessment.categories,
      riskLevel: assessment.overallRisk,
      summary: assessment.summary,
    };
  } catch (error) {
    console.error("Error parsing assessment response:", error);
    throw new Error("Failed to parse assessment response");
  }
};

/**
 * Normalize risk level to standard values
 * @param {string} riskLevel - Risk level from LLM
 * @returns {string} - Normalized risk level
 */
const normalizeRiskLevel = (riskLevel) => {
  const level = riskLevel.toLowerCase();

  if (level.includes("high")) return RISK_LEVELS.HIGH;
  if (level.includes("medium") || level.includes("moderate"))
    return RISK_LEVELS.MEDIUM;
  if (level.includes("low")) return RISK_LEVELS.LOW;

  return RISK_LEVELS.UNKNOWN;
};

/**
 * Common paths to try for finding user agreements
 */
const COMMON_AGREEMENT_PATHS = [
  "/privacy",
  "/terms",
  "/privacy-policy",
  "/legal/privacy-policy",
  "/legal/privacy",
  "/legal/terms",
  "/about/privacy",
  "/about/terms",
  "/privacy-notice",
  "/data-policy",
];

/**
 * Google-specific paths to try for finding user agreements
 */
const GOOGLE_AGREEMENT_PATHS = [
  "/policies/privacy",
  "/policies/terms",
  "/policies",
  "/intl/en/policies/privacy",
  "/intl/en/policies/terms",
  "/intl/en/privacy",
  "/intl/en/terms",
  "/about/policies",
  "/about/privacy",
  "/about/terms",
];

/**
 * Extract user agreement text from a website
 * @param {string} url - Website URL
 * @returns {Promise<Object>} - Extracted text and hash
 */
const extractUserAgreement = async (url) => {
  try {
    // Normalize URL
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith("http")) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    // Remove trailing slash if present
    if (normalizedUrl.endsWith("/")) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    console.log(`[LLMService] Looking for user agreement at ${normalizedUrl}`);

    // Determine if this is a Google domain
    const isGoogleDomain =
      normalizedUrl.includes("google.com") ||
      normalizedUrl.includes("google.") ||
      normalizedUrl === "google";

    console.log(`[LLMService] Is Google domain: ${isGoogleDomain}`);

    // Choose the appropriate paths to try
    const pathsToTry = isGoogleDomain
      ? [...GOOGLE_AGREEMENT_PATHS, ...COMMON_AGREEMENT_PATHS]
      : COMMON_AGREEMENT_PATHS;

    console.log(`[LLMService] Will try ${pathsToTry.length} possible paths`);

    // Try each path
    for (const path of pathsToTry) {
      const agreementUrl = `${normalizedUrl}${path}`;

      try {
        console.log(`[LLMService] Trying path: ${agreementUrl}`);

        const axios = require("axios");
        const response = await axios.get(agreementUrl, {
          timeout: 15000, // 15 second timeout (increased from 10)
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          maxRedirects: 5,
        });

        // Check if response is valid
        if (response.status === 200 && response.data) {
          console.log(
            `[LLMService] Got 200 response from ${agreementUrl}, content length: ${response.data.length}`
          );

          // Extract text from HTML
          const text = extractTextFromHtml(response.data);
          console.log(
            `[LLMService] Extracted text length: ${text.length} chars`
          );

          // Check if text is long enough to be a privacy policy
          if (text.length > 500) {
            console.log(
              `[LLMService] Found valid user agreement at ${agreementUrl}`
            );

            // Compute hash of text
            const hash = computeTextHash(text);
            console.log(
              `[LLMService] Computed hash: ${hash.substring(0, 10)}...`
            );

            return {
              text,
              hash,
              url: agreementUrl,
            };
          } else {
            console.log(
              `[LLMService] Text too short (${text.length} chars) to be a valid agreement`
            );
          }
        } else {
          console.log(`[LLMService] Got non-200 response: ${response.status}`);
        }
      } catch (error) {
        // Log error but continue trying other paths
        console.log(
          `[LLMService] Error trying path ${agreementUrl}: ${error.message}`
        );
      }
    }

    // Special handling for Google
    if (isGoogleDomain) {
      console.log(`[LLMService] Special handling for Google domain`);
      try {
        // Try to get Google's privacy policy directly
        const googlePrivacyUrl = "https://policies.google.com/privacy";
        console.log(
          `[LLMService] Trying direct Google privacy URL: ${googlePrivacyUrl}`
        );

        const axios = require("axios");
        const response = await axios.get(googlePrivacyUrl, {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          maxRedirects: 5,
        });

        if (response.status === 200 && response.data) {
          console.log(
            `[LLMService] Got 200 response from direct Google URL, content length: ${response.data.length}`
          );

          // Extract text from HTML
          const text = extractTextFromHtml(response.data);
          console.log(
            `[LLMService] Extracted text length: ${text.length} chars`
          );

          if (text.length > 500) {
            console.log(`[LLMService] Found valid Google privacy policy`);

            // Compute hash of text
            const hash = computeTextHash(text);

            return {
              text,
              hash,
              url: googlePrivacyUrl,
            };
          }
        }
      } catch (error) {
        console.log(
          `[LLMService] Error with direct Google URL: ${error.message}`
        );
      }

      // If we still haven't found anything, use a hardcoded snippet of Google's privacy policy
      console.log(
        `[LLMService] Using hardcoded Google privacy policy as fallback`
      );
      const googlePrivacyText = `Google Privacy Policy
When you use our services, you're trusting us with your information. We understand this is a big responsibility and work hard to protect your information and put you in control.

This Privacy Policy is meant to help you understand what information we collect, why we collect it, and how you can update, manage, export, and delete your information.

We build a range of services that help millions of people daily to explore and interact with the world in new ways. Our services include:
- Google apps, sites, and devices, like Search, YouTube, and Google Home
- Platforms like the Chrome browser and Android operating system
- Products that are integrated into third-party apps and sites, like ads and embedded Google Maps

You can use our services in a variety of ways to manage your privacy. For example, you can sign up for a Google Account if you want to create and manage content like emails and photos, or see more relevant search results. And you can use many Google services when you're signed out or without creating an account at all, like searching on Google or watching YouTube videos. You can also choose to browse the web privately using Chrome in Incognito mode. And across our services, you can adjust your privacy settings to control what we collect and how your information is used.

We collect information to provide better services to all our users — from figuring out basic stuff like which language you speak, to more complex things like which ads you'll find most useful, the people who matter most to you online, or which YouTube videos you might like.`;

      const hash = computeTextHash(googlePrivacyText);

      return {
        text: googlePrivacyText,
        hash,
        url: "https://policies.google.com/privacy",
      };
    }

    // No agreement found, throw error
    throw new Error(`No user agreement found for ${url}`);
  } catch (error) {
    console.error("Error extracting user agreement:", error);
    throw new Error(`Failed to extract user agreement: ${error.message}`);
  }
};

/**
 * Extract text content from HTML
 * @param {string} html - HTML content
 * @returns {string} - Extracted text
 */
function extractTextFromHtml(html) {
  // Simple HTML to text conversion
  let text = html;

  // Remove scripts
  text = text.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    " "
  );

  // Remove styles
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Compute SHA-256 hash of text
 * @param {string} text - Text to hash
 * @returns {string} - SHA-256 hash
 */
const computeTextHash = (text) => {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
};

// Exported service object
const llmService = {
  RISK_LEVELS,
  PRIVACY_CATEGORIES,
  estimateTokens,
  splitTextIntoChunks,
  getRiskPriority,
  // Move assessPrivacyPolicy inside the exported object
  async assessPrivacyPolicy(policyText) {
    try {
      // Use more accurate token estimation
      const estimatedTokens = estimateTokens(policyText);
      const textLength = policyText.length;

      // Always use chunking for policies over 10,000 characters, regardless of token estimate
      // This is a more conservative approach to avoid rate limits
      if (estimatedTokens < 8000 && textLength < 10000) {
        console.log(
          `Processing policy directly (est. ${estimatedTokens} tokens, ${textLength} chars)`
        );
        const prompt = createAssessmentPrompt(policyText);
        const response = await callLLMWithRetry(prompt);
        return parseAssessmentResponse(response.text);
      }

      // For larger policies, split into chunks and process each chunk
      console.log(
        `Policy text is large (est. ${Math.round(
          estimatedTokens
        )} tokens, ${textLength} chars), splitting into chunks`
      );

      // Split text into smaller chunks (target ~4000 tokens per chunk)
      const chunks = splitTextIntoChunks(policyText, 4000 * 4); // 4000 tokens ≈ 16000 chars
      console.log(`Split policy into ${chunks.length} chunks`);

      // Process each chunk
      const chunkAssessments = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}`);
        const chunkPrompt = createChunkAssessmentPrompt(
          chunks[i],
          i + 1,
          chunks.length
        );

        // Use retry logic for each chunk
        const chunkResponse = await callLLMWithRetry(chunkPrompt);
        const chunkAssessment = parseAssessmentResponse(chunkResponse.text);
        chunkAssessments.push(chunkAssessment);

        // Add a longer delay between chunks to avoid rate limiting
        if (i < chunks.length - 1) {
          const delayMs = 5000; // 5 seconds
          console.log(
            `Adding ${delayMs}ms delay between chunk processing to avoid rate limits`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      // Combine chunk assessments into a final assessment
      return combineChunkAssessments(chunkAssessments);
    } catch (error) {
      console.error("Error assessing privacy policy:", error);
      throw new Error("Failed to assess privacy policy");
    }
  },
  async analyzePrivacyPolicy(url, policyText) {
    if (!url) {
      throw new Error('URL is required');
    }
    if (!policyText) {
      throw new Error('Policy text is required');
    }

    // Check if assessment already exists
    const existingAssessment = await db.getAssessment(url);
    if (existingAssessment) {
      return existingAssessment;
    }

    // Call the internal method using 'this'
    const assessment = await this.assessPrivacyPolicy(policyText);

    // Save the assessment
    const savedAssessment = await db.upsertAssessment({
      url,
      content: policyText,
      analysis: assessment
    });

    return savedAssessment;
  },
  extractUserAgreement,
  computeTextHash,
  callLLMWithRetry,
  combineChunkAssessments,
};

module.exports = llmService;
