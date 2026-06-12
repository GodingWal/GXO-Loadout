# Use a slim Python base image
FROM python:3.11-slim

# Install Node.js so we can build the React application inside the container
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency configs
COPY package*.json ./
COPY requirements.txt ./

# Install Python and Node packages
RUN pip install --no-cache-dir -r requirements.txt
RUN npm install

# Copy application source code
COPY . .

# Build React production bundle
RUN npm run build

# Expose port 8000
EXPOSE 8000

# Start FastAPI edge server
CMD ["python", "server.py"]
