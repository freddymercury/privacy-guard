module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/config/**",
    "!src/migrations/**",
    "!**/node_modules/**"
  ],

  // The test coverage threshold enforcement
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Coverage reporters to use
  coverageReporters: ["text", "lcov", "html"],

  // A list of paths to directories that Jest should use to search for files in
  roots: ["<rootDir>/test"],

  // The test environment that will be used for testing
  testEnvironment: "node",

  // Suppress console output during tests
  silent: true,
}; 