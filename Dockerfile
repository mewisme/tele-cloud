FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Create metadata directory
RUN mkdir -p metadata

# Expose port
EXPOSE 3000

# Set command
CMD ["node", "node_server.js"]
