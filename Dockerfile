# Use the official Bun image
FROM oven/bun:alpine

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install

# Copy the rest of the source code
COPY . .

# Remove any .env files to prevent secrets leaking in image layers
RUN rm -f .env .env.*

# Generate the Prisma Client using a dummy URL just to satisfy the build step
RUN DATABASE_URL="postgresql://dummy" bunx prisma generate

# Expose the Elysia port
EXPOSE 3000

# Start script: Read Docker Secret to construct DATABASE_URL, run migrations, then start the server
CMD sh -c "\
  if [ -f /run/secrets/db_password ]; then \
    export DATABASE_URL=\"postgresql://admin:$(cat /run/secrets/db_password)@${DB_HOST:-localhost}:5432/${DB_NAME:-plpp_cloud}\"; \
  fi && \
  bunx prisma generate && \
  bunx prisma db push && \
  bun src/index.ts"