import dotenv from "dotenv";

dotenv.config();

// Set DATABASE_URL from individual database components if not already set
if (!process.env.DATABASE_URL && process.env.DB_USERNAME) {
  const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

  if (DB_USERNAME && DB_PASSWORD && DB_HOST && DB_PORT && DB_NAME) {
    // URL encode the username and password to handle special characters
    const encodedUsername = encodeURIComponent(DB_USERNAME);
    const encodedPassword = encodeURIComponent(DB_PASSWORD);

    process.env.DATABASE_URL = `postgresql://${encodedUsername}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  }
}
