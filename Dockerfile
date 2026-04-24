# Use the official Bun image
FROM oven/bun:alpine

WORKDIR /app

# Copy dependency files
COPY package.json bun.lockb ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install

# Copy the rest of the source code
COPY . .

# Generate the Prisma Client
RUN bunx prisma generate

# Expose the Elysia port
EXPOSE 3000

# Start script: Run migrations, then start the server
# (Using sh -c ensures it waits for Postgres to be ready and applies DB changes before booting)
CMD sh -c "bunx prisma migrate deploy && bun src/index.ts"