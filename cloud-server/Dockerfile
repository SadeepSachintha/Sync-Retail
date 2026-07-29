FROM node:20

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

EXPOSE 4000

CMD ["npm", "start"]
