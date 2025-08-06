FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S aidev -u 1001 && \
    chown -R aidev:nodejs /app

USER aidev

EXPOSE 8000

CMD ["npm", "start"]