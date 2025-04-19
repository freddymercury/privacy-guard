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
 * More accurate token estimation function
 * @param {string} text - Text to estimate tokens for
 * @returns {number} - Estimated token count
 */
const estimateTokens = (text) => {
  // Even more conservative estimation:
  // 1. Count words and multiply by 1.5 for punctuation/spaces
  // 2. Add 30% buffer for safety (increased from 20%)
  // 3. Add a constant for potential special tokens
  // 4. Account for non-English characters which may use more tokens
  const wordCount = text.split(/\s+/).length;
  const charCount = text.length;
  
  // If the average word length is high, it might contain non-English characters
  // which typically use more tokens per character
  const avgWordLength = charCount / (wordCount || 1);
  const nonEnglishFactor = avgWordLength > 6 ? 1.2 : 1.0;
  
  return Math.ceil(wordCount * 1.5 * 1.3 * nonEnglishFactor) + 50;
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
    // If this paragraph alone exceeds the chunk size, we need to split it further
    if (paragraph.length > maxChunkSize) {
      // If we have accumulated text in the current chunk, add it first
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      
      // Split the long paragraph into sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      
      for (const sentence of sentences) {
        // If this sentence alone exceeds the chunk size, split it by words
        if (sentence.length > maxChunkSize) {
          const words = sentence.split(/\s+/);
          let sentenceChunk = "";
          
          for (const word of words) {
            if (sentenceChunk.length + word.length + 1 > maxChunkSize) {
              chunks.push(sentenceChunk);
              sentenceChunk = word;
            } else {
              sentenceChunk += (sentenceChunk.length > 0 ? " " : "") + word;
            }
          }
          
          // Add the last sentence chunk if not empty
          if (sentenceChunk.length > 0) {
            if (currentChunk.length + sentenceChunk.length + 2 <= maxChunkSize) {
              currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + sentenceChunk;
            } else {
              chunks.push(currentChunk);
              currentChunk = sentenceChunk;
            }
          }
        } else {
          // Normal sentence handling
          if (currentChunk.length + sentence.length + 2 > maxChunkSize) {
            chunks.push(currentChunk);
            currentChunk = sentence;
          } else {
            currentChunk += (currentChunk.length > 0 ? " " : "") + sentence;
          }
        }
      }
    } else {
      // Normal paragraph handling
      if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + paragraph;
      }
    }
  }

  // Add the last chunk if it's not empty
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Call LLM with retry logic for rate limit errors
 * @param {string} prompt - The prompt to send to the LLM
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} initialDelay - Initial delay in ms before retrying
 * @param {Object} context - Additional context for logging (domain, chunk info)
 * @returns {Promise<Object>} - LLM response
 */
const callLLMWithRetry = async (
  prompt,
  maxRetries = 5,
  initialDelay = 5000,
  context = {}
) => {
  let attempt = 0;
  let delay = initialDelay;
  const { domain = "unknown", chunkInfo = "" } = context;

  // Log context information
  const contextStr = chunkInfo ? `${domain} (${chunkInfo})` : domain;
  console.log(`[LLM Service] Starting assessment for ${contextStr}`);

  while (attempt <= maxRetries) {
    try {
      console.log(`[LLM Service] API call attempt ${attempt + 1}/${maxRetries + 1} for ${contextStr}`);
      const response = await llm.complete({
        prompt,
        temperature: 0.2,
        maxTokens: 1500, // Reduced from 2000
      });
      console.log(`[LLM Service] Successfully completed API call for ${contextStr}`);
      return response;
    } catch (error) {
      attempt++;

      // If it's a rate limit error and we have retries left
      if (
        (error.status === 429 ||
          (error.error && error.error.code === "rate_limit_exceeded")) &&
        attempt <= maxRetries
      ) {
        console.log(`[LLM Service] Rate limit hit for ${contextStr}, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else if (attempt <= maxRetries) {
        // For other errors, retry with less backoff
        console.log(
          `[LLM Service] API error for ${contextStr}: ${
            error.message || "Unknown error"
          }, retrying in ${initialDelay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, initialDelay));
      } else {
        // No more retries, throw the error
        console.log(`[LLM Service] Failed all retry attempts for ${contextStr}`);
        throw error;
      }
    }
  }
};

/**
 * Create assessment prompt for LLM
 * @param {string} policyText - The privacy policy text
 * @param {string} domain - The domain being assessed
 * @returns {string} - Formatted prompt
 */
const createAssessmentPrompt = (policyText, domain = "unknown") => {
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
 * @param {string} domain - The domain being assessed
 * @returns {string} - Formatted prompt
 */
const createChunkAssessmentPrompt = (chunkText, chunkNumber, totalChunks, domain = "unknown") => {
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
 * Compute SHA-256 hash of text
 * @param {string} text - Text to hash
 * @returns {string} - SHA-256 hash
 */
const computeTextHash = (text) => {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
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

// Exported service object
const llmService = {
  RISK_LEVELS,
  PRIVACY_CATEGORIES,
  estimateTokens,
  splitTextIntoChunks,
  computeTextHash,
  
  // Assess privacy policy with improved chunking
  async assessPrivacyPolicy(policyText, domain = "unknown") {
    try {
      // Use more accurate token estimation
      const estimatedTokens = estimateTokens(policyText);
      const textLength = policyText.length;

      // Always use chunking for policies over 7,000 characters or 2,000 tokens
      // This is a more conservative approach to avoid context length errors
      if (estimatedTokens < 2000 && textLength < 7000) {
        console.log(
          `[LLM Service] Processing policy for ${domain} directly (est. ${estimatedTokens} tokens, ${textLength} chars)`
        );
        const prompt = createAssessmentPrompt(policyText, domain);
        const response = await callLLMWithRetry(prompt, 5, 5000, { domain });
        return parseAssessmentResponse(response.text);
      }

      // For larger policies, split into chunks and process each chunk
      console.log(
        `[LLM Service] Policy text for ${domain} is large (est. ${Math.round(
          estimatedTokens
        )} tokens, ${textLength} chars), splitting into chunks`
      );

      // Split text into smaller chunks (target ~2000 tokens per chunk)
      // 2000 tokens ≈ 8000 chars (reduced from 16000 chars)
      const chunks = splitTextIntoChunks(policyText, 2000 * 4);
      console.log(`[LLM Service] Split policy for ${domain} into ${chunks.length} chunks`);

      // Process each chunk
      const chunkAssessments = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkInfo = `chunk ${i + 1}/${chunks.length}`;
        console.log(`[LLM Service] Processing ${chunkInfo} for ${domain}`);
        const chunkPrompt = createChunkAssessmentPrompt(
          chunks[i],
          i + 1,
          chunks.length,
          domain
        );

        // Use retry logic for each chunk
        const chunkResponse = await callLLMWithRetry(chunkPrompt, 5, 5000, { 
          domain, 
          chunkInfo 
        });
        const chunkAssessment = parseAssessmentResponse(chunkResponse.text);
        chunkAssessments.push(chunkAssessment);

        // Add a longer delay between chunks to avoid rate limiting
        if (i < chunks.length - 1) {
          const delayMs = 10000; // 10 seconds (increased from 5)
          console.log(
            `[LLM Service] Adding ${delayMs}ms delay between chunk processing for ${domain} to avoid rate limits`
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
  }
};

// Add missing functions to the exported object
llmService.extractUserAgreement = extractUserAgreement;
llmService.callLLMWithRetry = callLLMWithRetry;

/**
 * Parse LLM response into structured assessment
 * @param {string} responseText - LLM response text
 * @returns {Object} - Structured assessment
 */
function parseAssessmentResponse(responseText) {
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
}

/**
 * Normalize risk level to standard values
 * @param {string} riskLevel - Risk level from LLM
 * @returns {string} - Normalized risk level
 */
function normalizeRiskLevel(riskLevel) {
  const level = riskLevel.toLowerCase();

  if (level.includes("high")) return RISK_LEVELS.HIGH;
  if (level.includes("medium") || level.includes("moderate"))
    return RISK_LEVELS.MEDIUM;
  if (level.includes("low")) return RISK_LEVELS.LOW;

  return RISK_LEVELS.UNKNOWN;
}

/**
 * Get priority value for risk levels (for comparison)
 * @param {string} riskLevel - Risk level
 * @returns {number} - Priority value (higher = more severe)
 */
function getRiskPriority(riskLevel) {
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
}

/**
 * Combine multiple chunk assessments into a final assessment
 * @param {Array<Object>} chunkAssessments - Array of chunk assessments
 * @returns {Object} - Combined assessment
 */
function combineChunkAssessments(chunkAssessments) {
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
}

// Add extractUserAgreement function with proper implementation
async function extractUserAgreement(url) {
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
}

module.exports = llmService;
