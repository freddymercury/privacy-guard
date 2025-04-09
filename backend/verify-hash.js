// Script to verify bcrypt hash for "password123"
const bcrypt = require("bcrypt");

const password = "password123";
const storedHash =
  "$2b$10$rBVQjJRQFP5VVFDTm1XvL.j8Yt1UU6rVqVE3wRpwYDhwPvLtEXAHu";

// Verify the hash
bcrypt.compare(password, storedHash, (err, result) => {
  if (err) {
    console.error("Error comparing hash:", err);
    return;
  }

  console.log(`Password "password123" matches the stored hash: ${result}`);

  // Generate a new hash for comparison
  bcrypt.hash(password, 10, (err, newHash) => {
    if (err) {
      console.error("Error generating new hash:", err);
      return;
    }

    console.log("New hash generated:", newHash);
    console.log("Stored hash:       ", storedHash);
  });
});
