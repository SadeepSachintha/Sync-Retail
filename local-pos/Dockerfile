FROM node:20

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Ensure data directory exists for SQLite db persistence
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
