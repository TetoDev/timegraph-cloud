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

# Generate the Prisma Client using a dummy URL just to satisfy the build step
RUN DATABASE_URL="postgresql://dummy" bunx prisma generate

# Expose the Elysia port
EXPOSE 3000

# Start script: Run migrations, then start the server
CMD sh -c "bunx prisma generate && bunx prisma db push && bun src/index.ts"